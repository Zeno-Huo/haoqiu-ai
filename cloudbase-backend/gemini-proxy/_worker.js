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

/** Gemini Files API 上传：start -> 流式 upload+finalize，返回 file 元数据 */
async function uploadVideo(request, url, key) {
  const mime = url.searchParams.get('mime') || 'video/mp4';
  const name = url.searchParams.get('name') || 'haoqiu-' + Date.now();
  const sizeHeader = request.headers.get('x-video-size');

  if (!request.body) return json({ error: 'request body is empty' }, 400);

  // 1) 开一个 resumable 上传会话
  const startHeaders = {
    'X-Goog-Upload-Command': 'start',
    'X-Goog-Upload-Header-Content-Type': mime,
    'Content-Type': 'application/json',
  };
  if (sizeHeader) startHeaders['X-Goog-Upload-Header-Content-Length'] = String(sizeHeader);

  const startResp = await fetch(`${GOOGLE}/upload/v1beta/files?key=${key}`, {
    method: 'POST',
    headers: startHeaders,
    body: JSON.stringify({ file: { display_name: name } }),
  });

  if (!startResp.ok) {
    return json(
      { error: 'files:start failed', status: startResp.status, detail: (await startResp.text()).slice(0, 500) },
      502
    );
  }

  const uploadUrl = startResp.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) return json({ error: 'files:start returned no upload url' }, 502);

  // 2) 把客户端传来的视频字节流直接转发给 Google（不缓存到内存，Worker 内存仅 128MB）
  const upResp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'Content-Type': mime,
    },
    body: request.body,
    duplex: 'half',
  });

  const data = await upResp.json().catch(() => null);
  if (!upResp.ok || !data) {
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
