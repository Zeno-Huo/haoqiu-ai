/**
 * EdgeOne Pages Functions —— Gemini API 中转代理
 * ------------------------------------------------------------
 * 为什么需要它：腾讯云函数（上海）出口 IP 访问不了 Google —— Google Cloud 的
 * 全球负载均衡对大陆 IP 段主动发 RST。EdgeOne Pages 的边缘节点在境外，能正常
 * 访问 generativelanguage.googleapis.com，云函数把请求发给本函数转发即可。
 *
 * 端点（本文件匹配站点所有路径）：
 *   GET  /health                       —— 探活（不校验 token）
 *   GET  /netcheck                     —— 从边缘节点实测能否访问 Google（不校验 token）
 *   POST /files/upload?name=xx&mime=video/mp4  —— 一步完成 Gemini Files API 上传
 *   /v1beta/*  与  /upload/v1beta/*    —— 原样透传（自动注入 API key）
 *
 * 鉴权：请求头 x-proxy-token 必须等于环境变量 PROXY_TOKEN。
 *
 * 需在 Pages 控制台配置环境变量：
 *   GEMINI_API_KEY = Google AI Studio 的 key
 *   PROXY_TOKEN    = 自定义长随机串（云函数侧配同样的值）
 */

const GOOGLE = 'https://generativelanguage.googleapis.com';

// EdgeOne 节点出口 IP 可能被 Google 判定为不支持地区（FAILED_PRECONDITION:
// User location is not supported），此时把请求转交给另一个境外代理（Cloudflare
// Worker）转发即可 —— 它的出口在美国，Google 放行。
const RELAY_DEFAULT = 'https://haoqiu-gemini.bingzhi0019.workers.dev';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    },
  });

export async function onRequest(context) {
  const { request, env } = context;

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

  const url = new URL(request.url);

  // 探活：不校验 token，方便快速确认函数是否活着、环境变量有没有配好
  if (url.pathname === '/health') {
    return json({ ok: true, hasKey: Boolean(env.GEMINI_API_KEY), ts: Date.now() });
  }

  // 连通性自检：从边缘节点直接打 Google，用来判断这个节点到底能不能出国
  // 调试用：/netcheck?k=xxx 用指定 key 探测；?mode=all 时同时试 query / header / bearer 三种传法
  if (url.pathname === '/netcheck') {
    const probeKey = url.searchParams.get('k') || env.GEMINI_API_KEY || 'no-key';
    const mode = url.searchParams.get('mode') || 'all';
    const tag = probeKey.slice(0, 6) + '...' + probeKey.slice(-4);
    const started = Date.now();

    const tryOnce = async (label, build) => {
      const t = Date.now();
      try {
        const r = await build();
        const text = await r.text();
        return { label, status: r.status, ms: Date.now() - t, body: text.slice(0, 200) };
      } catch (e) {
        return { label, error: String((e && e.message) || e), ms: Date.now() - t };
      }
    };

    if (mode === 'all') {
      const results = await Promise.all([
        tryOnce('query-key', () => fetch(`${GOOGLE}/v1beta/models?key=${probeKey}`)),
        tryOnce('header-x-goog', () => fetch(`${GOOGLE}/v1beta/models`, { headers: { 'x-goog-api-key': probeKey } })),
        tryOnce('bearer', () => fetch(`${GOOGLE}/v1beta/models`, { headers: { Authorization: `Bearer ${probeKey}` } })),
      ]);
      return json({ reached: true, usingKey: tag, attempts: results });
    }

    try {
      const r = await fetch(`${GOOGLE}/v1beta/models?key=${probeKey}`, { method: 'GET' });
      const text = await r.text();
      return json({
        reached: true,
        status: r.status,
        ms: Date.now() - started,
        usingKey: tag,
        body: text.slice(0, 300),
      });
    } catch (e) {
      return json({
        reached: false,
        ms: Date.now() - started,
        error: String((e && e.message) || e),
      });
    }
  }

  // 出口 IP / 归属地探测：判断边缘节点到底在哪个国家
  if (url.pathname === '/geo') {
    const out = {};
    const grab = async (label, u) => {
      const t = Date.now();
      try {
        const r = await fetch(u, { headers: { accept: 'application/json' } });
        out[label] = { status: r.status, ms: Date.now() - t, body: (await r.text()).slice(0, 400) };
      } catch (e) {
        out[label] = { error: String((e && e.message) || e), ms: Date.now() - t };
      }
    };
    await Promise.all([
      grab('ipinfo', 'https://ipinfo.io/json'),
      grab('ifconfig', 'https://ifconfig.co/json'),
    ]);
    return json(out);
  }

  // 中继探测：本节点可能被 Google 封锁地区限制，尝试借道另一个境外代理再打 Google
  // /relaycheck?r=https://xxx.workers.dev[&k=KEY]
  if (url.pathname === '/relaycheck') {
    const relay = (url.searchParams.get('r') || '').replace(/\/+$/, '');
    const probeKey = url.searchParams.get('k') || env.GEMINI_API_KEY || 'no-key';
    if (!relay) return json({ error: 'missing ?r=' }, 400);

    const step = async (label, u, init) => {
      const t = Date.now();
      try {
        const r = await fetch(u, init);
        const text = await r.text();
        return { label, status: r.status, ms: Date.now() - t, body: text.slice(0, 220) };
      } catch (e) {
        return { label, error: String((e && e.message) || e), ms: Date.now() - t };
      }
    };

    const results = [];
    results.push(await step('relay-health', `${relay}/health`));
    results.push(
      await step('relay-google', `${relay}/v1beta/models?key=${probeKey}`, {
        headers: { 'x-proxy-token': env.RELAY_TOKEN || env.PROXY_TOKEN || '' },
      })
    );
    return json({ relay, attempts: results });
  }

  if (!env.PROXY_TOKEN || request.headers.get('x-proxy-token') !== env.PROXY_TOKEN) {
    return json({ error: 'unauthorized' }, 401);
  }

  const key = env.GEMINI_API_KEY;
  if (!key) return json({ error: 'GEMINI_API_KEY not configured' }, 500);

  try {
  const useRelay = url.searchParams.get('direct') !== '1';
  const relayBase = (env.RELAY_URL || RELAY_DEFAULT).replace(/\/+$/, '');

  if (url.pathname === '/files/upload' && request.method === 'POST') {
    if (useRelay) {
      return await relayForward(request, url, `${relayBase}/files/upload`, env);
    }
    return await uploadVideo(request, url, key);
  }
  if (url.pathname.startsWith('/v1beta/') || url.pathname.startsWith('/upload/v1beta/')) {
    if (useRelay) {
      const qs = new URLSearchParams(url.searchParams);
      qs.delete('key');
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return await relayForward(request, url, `${relayBase}${url.pathname}${suffix}`, env);
    }
    return await passthrough(request, url, key);
  }
  if (url.pathname.startsWith('/relay/')) {
    const suffix = url.pathname.slice('/relay'.length);
    return await relayForward(request, url, `${relayBase}${suffix}`, env);
  }
    return json({ error: 'unknown path: ' + url.pathname }, 404);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 502);
  }
}

/** Gemini Files API 上传：start -> 上传+finalize，返回 file 元数据（含 uri） */
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
      {
        error: 'files:start failed',
        status: startResp.status,
        detail: (await startResp.text()).slice(0, 500),
      },
      502
    );
  }

  const uploadUrl = startResp.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) return json({ error: 'files:start returned no upload url' }, 502);

  // 2) 把客户端传来的视频字节流转发给 Google（尽量流式，避免占用函数内存）
  let upResp;
  try {
    upResp = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Command': 'upload, finalize',
        'X-Goog-Upload-Offset': '0',
        'Content-Type': mime,
      },
      body: request.body,
      duplex: 'half',
    });
  } catch (e) {
    // 部分运行时不支持 duplex 流式请求体，退化为整体读取（视频需控制在几十 MB 内）
    const buf = await request.arrayBuffer();
    upResp = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Command': 'upload, finalize',
        'X-Goog-Upload-Offset': '0',
        'Content-Type': mime,
        'Content-Length': String(buf.byteLength),
      },
      body: buf,
    });
  }

  const data = await upResp.json().catch(() => null);
  if (!upResp.ok || !data) {
    return json(
      {
        error: 'files:upload failed',
        status: upResp.status,
        detail: JSON.stringify(data).slice(0, 500),
      },
      502
    );
  }
  return json(data, 200);
}

/**
 * 把请求整体转交给另一个境外代理（Cloudflare Worker）转发到 Google。
 * 中继自带 GEMINI_API_KEY，本节点不需要 key，只需带上中继自己的 token。
 */
async function relayForward(request, url, target, env) {
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('content-length');
  headers.set('x-proxy-token', env.RELAY_TOKEN || env.PROXY_TOKEN || '');

  const hasBody = !['GET', 'HEAD'].includes(request.method);
  let resp;
  try {
    resp = await fetch(target, {
      method: request.method,
      headers,
      ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
    });
  } catch (e) {
    const buf = hasBody ? await request.arrayBuffer() : null;
    resp = await fetch(target, {
      method: request.method,
      headers,
      ...(hasBody ? { body: buf } : {}),
    });
  }

  const out = new Headers(resp.headers);
  out.set('access-control-allow-origin', '*');
  out.set('x-relayed-by', 'edgeone');
  return new Response(resp.body, { status: resp.status, headers: out });
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
  headers.delete('content-length');

  const hasBody = !['GET', 'HEAD'].includes(request.method);

  let resp;
  try {
    resp = await fetch(target.toString(), {
      method: request.method,
      headers,
      ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
    });
  } catch (e) {
    const buf = hasBody ? await request.arrayBuffer() : null;
    resp = await fetch(target.toString(), {
      method: request.method,
      headers,
      ...(hasBody ? { body: buf } : {}),
    });
  }

  const out = new Headers(resp.headers);
  out.set('access-control-allow-origin', '*');
  return new Response(resp.body, { status: resp.status, headers: out });
}
