# Gemini 中转 Worker 部署说明

国内云函数连不上 Google（Google Cloud 全球负载均衡对大陆 IP 主动发 RST），所以 Gemini 必须经境外节点转发。这个 Worker 就是这个转发层，跑在 Cloudflare 全球节点上，**免费额度 10 万请求/天**。

## 三步部署（网页版，不用装任何工具）

### 1. 创建 Worker

1. 打开 https://dash.cloudflare.com/ → 左侧 **Workers 和 Pages** → **创建** → **创建 Worker**
2. 名字随便起，比如 `haoqiu-gemini` → 点 **部署**
3. 部署完点 **编辑代码**，把 `worker.js` 里的**全部内容**粘进去（覆盖默认的 hello world）
4. 点右上角 **部署**

### 2. 配两个密钥

在 Worker 页面 → **设置** → **变量和机密** → 添加：

| 变量名 | 值 | 说明 |
|---|---|---|
| `GEMINI_API_KEY` | `AIza...` | 从 https://aistudio.google.com/apikey 拿（需要梯子） |
| `PROXY_TOKEN` | 自己生成一串长的 | 随便什么，比如 `openssl rand -hex 32` 的输出。**云函数侧要配同一个值** |

> 两个都要点「加密」存成 Secret，别明文。

### 3. 验证

把下面的 `<worker地址>` 和 `<token>` 换成你自己的：

```bash
# 探活
curl https://<worker地址>/health

# 列出可用模型（顺带确认 key 有效、网络通）
curl https://<worker地址>/v1beta/models -H "x-proxy-token: <token>"
```

返回模型列表就说明通了。**把 worker 地址和 PROXY_TOKEN 发给我**，我来配云函数。

## 模型怎么选

免费额度（2026 年 3 月削减后）：

| 模型 | 每分钟 | 每天 | 备注 |
|---|---|---|---|
| `gemini-2.5-flash` | 10 次 | 250 次 | **推荐**，速度快、视频理解强 |
| `gemini-2.5-flash-lite` | 15 次 | 1000 次 | 额度最大，能力弱一点 |
| `gemini-2.5-pro` | 5 次 | 100 次 | 最准，但一天只够跑 16 场 |

先默认 `gemini-2.5-flash`，不够或不准再换。

## 已知限制与应对

- **请求体上限 100MB**（Workers 免费版硬限制）：云函数侧已把视频压到 90MB 以内（原片过大自动压前 5 分钟 + 720p）。
- **TPM 25 万/分钟**：现在一次分析跑 6 轮，5 分钟视频约 8 万 token/轮，6 轮 ≈ 48 万，会撞限制报 429。
  真撞了有两个解法：① 6 轮合并成 2 轮（Gemini 有 100 万上下文，一次问得完）；② 轮间加延时跑慢点。
  先跑一次看实际情况再定，别提前优化。
- **隐私**：免费层 Google 可能会拿你的数据改进模型。视频是业余比赛，问题不大；介意就升付费档。

## 用 wrangler 部署（可选，给习惯命令行的）

```bash
npm i -g wrangler
wrangler login
wrangler init haoqiu-gemini --no-git
# 把 worker.js 内容覆盖到 src/index.js
wrangler secret put GEMINI_API_KEY
wrangler secret put PROXY_TOKEN
wrangler deploy
```
