# Gemini 中转代理（好球Ai）

国内云函数访问不了 Google，所以需要一个境外中转。本目录是中转代码 + 部署脚本。

## 一、为什么需要它

腾讯云函数（上海）→ `generativelanguage.googleapis.com` **直接不通**。Google Cloud 的全球负载均衡对大陆 IP 段主动发 RST，TCP 握手前就被拒，改 hosts / 换 DNS / 本地代理转发全部无效。

所以链路是：**云函数 → Cloudflare 中转（境外）→ Google Gemini**。

## 二、⚠️ 关键：中转域名必须选对

实测（2026-09-10，从腾讯云函数上海发起，6 秒超时）：

| 域名 | 结果 | 说明 |
|---|---|---|
| `*.workers.dev` | ❌ 连接超时 | **Cloudflare Workers 默认域名被墙** |
| `vercel.app` | ❌ 连接超时 | 同样被墙 |
| `fly.dev` | ❌ 连接超时 | 同样被墙 |
| `*.pages.dev` | ✅ 200 | **Cloudflare Pages，可用** |
| `deno.dev` | ✅ 200 | Deno Deploy，可用 |
| `netlify.app` / `onrender.com` | ✅ 200 | 可用 |
| `dashscope.aliyuncs.com` | ✅ 404 | 千问，对照组正常 |

**结论：不要用 Workers 的默认 `workers.dev` 域名，改用 Cloudflare Pages（`pages.dev`），或在 Workers 上绑自己的域名。**

> 教训：测可达性必须测「实际要用的那个域名」。`api.cloudflare.com` 通不代表 `workers.dev` 通。

## 三、部署（三选一）

### 方案 A：Cloudflare Pages + GitHub 集成（推荐，最稳）

代码已在仓库 `cloudbase-backend/gemini-proxy/`：
- `functions/[[path]].js` —— Pages Functions 版本（主用）
- `_worker.js` —— Advanced mode 版本（备用）

在 Cloudflare 控制台：
1. Workers 和 Pages → 创建 → Pages → 连接到 Git
2. 选 `Zeno-Huo/haoqiu-ai` 仓库
3. 构建设置：框架预设 **None**，构建命令**留空**，输出目录填 `cloudbase-backend/gemini-proxy`
4. 保存并部署 → 得到 `https://<项目名>.pages.dev`
5. 设置 → 环境变量和机密 → 加两个：
   - `GEMINI_API_KEY` = Google AI Studio 的 key
   - `PROXY_TOKEN` = 任意长随机串（云函数侧要配一样的值）
6. **重新部署一次**让环境变量生效

### 方案 B：wrangler 命令行

```bash
cd cloudbase-backend/gemini-proxy
CLOUDFLARE_API_TOKEN=xxx npx wrangler@3 pages deploy . --project-name haoqiu-gemini-p
```

### 方案 C：`deploy.sh`（仅适用于 Workers，不推荐）

```bash
export CF_API_TOKEN=... GEMINI_API_KEY=... PROXY_TOKEN=...
bash deploy.sh
```

跑得通，但生产出来的是 `workers.dev` 域名，**国内连不上**。除非你自己绑域名。

### ❌ 不行的路：Pages 直接上传 API

用 `POST /pages/projects/{name}/deployments` 直接上传文件，返回的部署里 `uses_functions: false`
—— 文件只被当成静态资产，Functions 不生效，请求一律 500。
**Functions 必须走构建流程**（GitHub 集成或 wrangler）。

## 四、云函数侧配置

`haoqiu-vlm` 环境变量：

| 变量 | 值 |
|---|---|
| `VLM_PROVIDER` | `gemini` |
| `VLM_MODEL` | `gemini-2.5-flash`（或 `gemini-2.5-pro`） |
| `GEMINI_PROXY_URL` | `https://<项目名>.pages.dev` |
| `GEMINI_PROXY_TOKEN` | 与 Pages 的 `PROXY_TOKEN` 一致 |

切回千问只需改两个：`VLM_PROVIDER=qwen`、`VLM_MODEL=qwen3-vl-plus`（不用重新部署代码）。

排查：`selfTest` 会返回 `proxyHealth`（中转是否可达）和 `geminiKey`（key 是否有效）。

## 五、接口说明

| 端点 | 用途 |
|---|---|
| `GET /health` | 探活，返回 `{ok, hasKey}`，不校验 token |
| `POST /files/upload?name=&mime=` | 一步完成 Gemini Files API 上传，流式转发不落内存 |
| `/v1beta/*`、`/upload/v1beta/*` | 通用透传到 Google，自动注入 API key |

鉴权：请求头 `x-proxy-token` 必须等于 `PROXY_TOKEN`。

## 六、额度（免费档，2026-03 后）

| 模型 | RPM | RPD | TPM |
|---|---|---|---|
| Gemini 2.5 Pro | 5 | 100 | 250K |
| Gemini 2.5 Flash | 10 | 250 | 250K |
| Gemini 2.5 Flash-Lite | 15 | 1000 | 250K |

当前 6 轮调用 → 约 41 次分析/天。若撞 TPM（5 分钟视频约 8 万 token × 6 轮 = 48 万），
把 6 轮合并成 1-2 轮即可（Gemini 有 1M 上下文，一次问完反而更准）。

## 七、已知限制

- Workers/Pages 免费版请求体上限 100MB → 云函数在 gemini 模式下会把视频压到 90MB 以下再传
- 免费版 CPU 时间 10ms/请求，大文件转发主要耗在网络等待，一般不受影响
- 视频先 `fetch` 进内存再转发（90MB 上限，云函数 1024MB 内存够用），不落盘所以不会 ENOSPC
