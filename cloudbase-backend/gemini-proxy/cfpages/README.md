# Gemini 中继代理（Cloudflare Pages）

腾讯云函数（上海）访问不了 Google，但能访问 `pages.dev`，所以把代理放在 Cloudflare Pages 上。

链路：腾讯云函数 → `https://haoqiu-gm2.pages.dev` → Google Gemini API

## 文件

- `_worker.js`：代理本体（与 `../worker.js` 相同，ESM `export default { fetch }`）
- `index.html`：占位首页

端点：`/health`（探活）、`/files/upload`（视频一次上传）、`/v1beta/*`（透传，自动注入 key）
鉴权：请求头 `x-proxy-token` = Pages 的 `PROXY_TOKEN`

## 重新部署

```bash
export CI=1 WRANGLER_SEND_METRICS=false
export CLOUDFLARE_API_TOKEN=$(cat ~/.workbuddy/.cf_token)
cd <node workspace> && node node_modules/.bin/wrangler pages deploy \
  <项目>/cloudbase-backend/gemini-proxy/cfpages \
  --project-name haoqiu-gm2 --branch main --commit-dirty=true
```

## 密钥（改完必须再 deploy 一次才生效）

```bash
printf '%s' '<GEMINI_API_KEY>' | node node_modules/.bin/wrangler pages secret put GEMINI_API_KEY --project-name haoqiu-gm2
printf '%s' '<PROXY_TOKEN>'    | node node_modules/.bin/wrangler pages secret put PROXY_TOKEN    --project-name haoqiu-gm2
```

## 验证

```bash
curl https://haoqiu-gm2.pages.dev/health
curl https://haoqiu-gm2.pages.dev/v1beta/models -H "x-proxy-token: <PROXY_TOKEN>"
```

从云函数侧验证：`manageFunctions(invokeFunction, haoqiu-vlm, {"selfTest":true})`
→ 看 `proxyHealth.status=200`、`geminiKey.ok=true`。
