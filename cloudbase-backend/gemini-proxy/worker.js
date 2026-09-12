/**
 * Cloudflare Worker —— Gemini API 中转代理
 * ------------------------------------------------------------
 * 为什么需要它：腾讯云函数（上海）出口 IP 访问不了 Google —— Google Cloud 的
 * 全球负载均衡对大陆 IP 段主动发 RST，TCP 握手前就被拒。Worker 跑在境外节点，
 * 能正常访问 generativelanguage.googleapis.com，云函数把请求发给 Worker 转发即可。
 *
 * 三个端点：
 *   1) POST /files/upload?name=xx&mime=video/mp4   —— 一步完成 Gemini Files API 上传
 *      （内部走 resumable: start -> upload+finalize），body 为视频字节流，流式转发不落内存
 *   2) /v1beta/*  与  /upload/v1beta/*              —— 原样透传（自动注入 API key）
 *   3) GET /health                                   —— 探活
 *
 * 鉴权：请求头 x-proxy-token 必须等于 Worker 的 PROXY_TOKEN 密钥。
 *
 * 部署后需要配置两个密钥（Worker Settings -> Variables and Secrets）：
 *   GEMINI_API_KEY = Google AI Studio 拿到的 key
 *   PROXY_TOKEN    = 自己随便生成一个长随机串（云函数侧要配同样的值）
 */

const GOOGLE = 'https://generativelanguage.googleapis.com';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
  });

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'access-control-allow-headers': 'content-type,x-proxy-token,x-goog-*',
        },
      });
    }

    // 探活不校验 token，方便快速确认 Worker 是否活着
    if (new URL(request.url).pathname === '/health') {
      return json({ ok: true, hasKey: Boolean(env.GEMINI_API_KEY), ts: Date.now() });
    }

    if (!env.PROXY_TOKEN || request.headers.get('x-proxy-token') !== env.PROXY_TOKEN) {
      return json({ error: 'unauthorized' }, 401);
    }

    const key = env.GEMINI_API_KEY;
    if (!key) return json({ error: 'GEMINI_API_KEY not configured on worker' }, 500);

    const url = new URL(request.url);
    try {
      if (url.pathname === '/files/debug' && request.method === 'POST') {
        return await filesDebug(request, url, key);
      }
      if (url.pathname === '/files/upload' && request.method === 'POST') {
        return await uploadVideo(request, url, key);
      }
      if (url.pathname.startsWith('/v1beta/') || url.pathname.startsWith('/upload/v1beta/')) {
        return await passthrough(request, url, key);
      }
      return json({ error: 'unknown path: ' + url.pathname }, 404);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 502);
    }
  },
};

/** 诊断：把 resumable start 请求的完整响应（状态/响应头/响应体）原样带回来，定位拿不到 upload url 的原因 */
async function filesDebug(request, url, key) {
  const results = [];
  const variants = [
    {
      label: 'command-start',
      headers: {
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Type': 'video/mp4',
        'X-Goog-Upload-Header-Content-Length': '1048576',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: 'debug-' + Date.now() } }),
    },
    {
      label: 'protocol-resumable',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Header-Content-Type': 'video/mp4',
        'X-Goog-Upload-Header-Content-Length': '1048576',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: 'debug-' + Date.now() } }),
    },
    {
      label: 'key-in-header',
      headers: {
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Type': 'video/mp4',
        'X-Goog-Upload-Header-Content-Length': '1048576',
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify({ file: { display_name: 'debug-' + Date.now() } }),
    },
  ];

  for (const v of variants) {
    const t = Date.now();
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/upload/v1beta/files${v.label === 'key-in-header' ? '' : `?key=${key}`}`,
        { method: 'POST', headers: v.headers, body: v.body }
      );
      const text = await r.text();
      const hdrs = {};
      r.headers.forEach((val, name) => { hdrs[name] = val.slice(0, 200); });
      results.push({ label: v.label, status: r.status, ms: Date.now() - t, headers: hdrs, body: text.slice(0, 400) });
    } catch (e) {
      results.push({ label: v.label, error: String((e && e.message) || e), ms: Date.now() - t });
    }
  }
  return json({ results });
}

/** Gemini Files API 上传：start -> 流式 upload+finalize，返回 file 元数据 */
async function uploadVideo(request, url, key) {
  const mime = url.searchParams.get('mime') || 'video/mp4';
  const name = url.searchParams.get('name') || 'haoqiu-' + Date.now();
  const sizeHeader = request.headers.get('x-video-size');

  if (!request.body) return json({ error: 'request body is empty' }, 400);

  // 2026 协议：单请求上传——`upload, finalize` 命令 + 字节流一步完成，
  // Google 在响应体里直接返回 file 元数据（含 uri），不再走 start -> X-Goog-Upload-URL 两步。
  const headers = {
    'X-Goog-Upload-Command': 'upload, finalize',
    'X-Goog-Upload-Header-Content-Type': mime,
    'Content-Type': mime,
  };
  if (sizeHeader) headers['X-Goog-Upload-Header-Content-Length'] = String(sizeHeader);

  const upResp = await fetch(`${GOOGLE}/upload/v1beta/files?key=${key}`, {
    method: 'POST',
    headers,
    body: request.body,
    duplex: 'half',
  });

  const data = await upResp.json().catch(() => null);
  if (!upResp.ok || !data || !data.file || !data.file.uri) {
    return json(
      { error: 'files:upload failed', status: upResp.status, detail: JSON.stringify(data).slice(0, 500) },
      502
    );
  }
  // data 形如 { file: { name:"files/xxx", uri:"https://generativelanguage.googleapis.com/v1beta/files/xxx",
  //                     mimeType, state:"PROCESSING"|"ACTIVE", ... } }
  return json(data, 200);
}

/** 通用透传：保留 path/query/method/headers/body，只注入 key 并去掉私有头 */
async function passthrough(request, url, key) {
  const target = new URL(GOOGLE + url.pathname);
  url.searchParams.forEach((v, k) => {
    if (k !== 'key') target.searchParams.set(k, v);
  });
  target.searchParams.set('key', key);

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('x-proxy-token');
  headers.delete('content-length'); // 让 fetch 按实际 body 重新计算

  const hasBody = !['GET', 'HEAD'].includes(request.method);

  const resp = await fetch(target.toString(), {
    method: request.method,
    headers,
    ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
  });

  const out = new Headers(resp.headers);
  out.set('access-control-allow-origin', '*');
  return new Response(resp.body, { status: resp.status, headers: out });
}
