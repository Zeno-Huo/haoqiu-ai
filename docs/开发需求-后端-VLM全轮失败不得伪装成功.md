# 开发需求 · 后端：VLM 全轮失败不得伪装成"成功但没识别到"

## 背景（2026-09-12 晚实测，证据可复现）

今晚复跑一段 33 秒素材，任务 `rc_9f3eaefb958f902b938f59ffa19c3cc1e009d7ee257a6f6e764473460f9b6bb6`，结果：

- `text_result.rounds` 6 轮**全部** `success: false`，`error` 全部是同一句：
  `千问API错误: Arrearage - Access denied, please make sure your account is in good standing.`
  （阿里云百炼账号欠费，`help.aliyun.com/zh/model-studio/error-code#overdue-payment`）
- 但任务本身：`status = "succeeded"`、`stage = "completed"`、`progress = 100`、`error = null`
- `structured` 里 `players = 0`、`events = 0`、`summary.*` 全 `null`

也就是说：**模型一次都没跑起来，后端却报了成功。**

## 问题

1. **失败被吞掉**。真实原因是"视觉模型账号欠费"，但它只存在于 `rounds[].error` 里，任务级 `error` 是 `null`。前端只能看到"成功 + 空数据"。
2. **前端被迫猜**。因为任务报成功且没有任何错误信息，前端只能落到诚实空态，于是显示「本次没有识别到明确的主要问题」——而真实情况是**模型根本没运行**。这句话在欠费场景下是错的，会把用户引向"素材不好"的错误结论。
3. **空跑浪费**。6 轮里的第 1 轮就已经拿到"账号欠费"这种**不可能自愈**的错误，后面 5 轮仍然照跑照失败，白等一轮、白记 5 条错。

## 需求

### 1. 供应商级错误要短路（`haoqiu-vlm/index.js` 轮次循环）

- 把"欠费 / 鉴权失败 / 限流 / 网络不可达"归为**不可自愈错误**。
- 第 1 轮命中这类错误时**立即中止剩余轮次**，不要继续空跑。
- 结果里保留中止前的轮次明细，并额外给出 `aborted_at_round` + `provider_error`。

### 2. 全部轮次失败时，任务必须判失败

- `haoqiu-vlm` 写回时：若 **0 轮成功**，写 `status: "failed"`、`stage: "failed"`、`error: { code, message }`，**不要**写 `succeeded`。
- `error.code` 按可读分类映射（中文 `message` 直接给用户看）：

  | 命中特征 | code | message 建议 |
  |---|---|---|
  | `Arrearage` / `overdue-payment` / 余额不足 | `VLM_PROVIDER_ARREARS` | 视觉模型账号余额不足，充值后即可恢复分析 |
  | 401 / 403 / `InvalidApiKey` | `VLM_PROVIDER_AUTH` | 视觉模型密钥无效或已失效 |
  | 429 / `Throttling` / 限流 | `VLM_PROVIDER_RATE_LIMIT` | 视觉模型调用频率受限，请稍后重试 |
  | 其余 | `VLM_PROVIDER_ERROR` | 视觉模型调用失败，请稍后重试 |

### 3. 部分失败要标降级（≥1 轮成功）

- 仍可 `succeeded`，但必须带 `degraded: true` + `failed_rounds: [轮次名...]`，让前端能在看板上如实说明"部分维度未能分析"。

### 4. 不改的部分

- `haoqiu-api` 无需改动：`publicTask` 已经把 `error` 与 `text_result` 一起透传给前端。
- 不要动现有 prompt 措辞（`返空正常` 那套在千问上已验证有效），本次问题与 prompt 无关。

## 验收标准

1. 临时把一个错误的 `VLM_API_KEY` 部署到 `haoqiu-vlm`，跑一次真实上传：
   - 任务终态必须是 **`failed`**，`error.code = VLM_PROVIDER_AUTH`，`error.message` 是中文可读文案；
   - **不得**出现 `succeeded` + 空看板。
2. 同样场景下，第 1 轮失败后**不再继续**执行后续轮次（日志里只有 1 条 provider 错误）。
3. 恢复正确 key 后，正常素材仍能产出完整看板（回归不破）。
4. 前端拿到 `failed` 时展示 `error.message`，而不是「本次没有识别到明确的主要问题」。

## 关联

- 前端假兜底（`n.highlight||"进攻推进更主动"` 等）**已在 `feat/emotional-match-dashboard` 本地构建中移除**，新版落的是诚实空态（`本次没有识别到明确的主要问题。` / `这段视频暂未标出关键片段。`）+ 比分「未识别」。**待部署**，不需要新需求。
- 本需求与"回填"无关：回填版行为正确（`rc_` 前缀、轮询补发、rounds 明细都工作正常），本需求是在回填之上补的**失败态契约**。

---

## 实施结果（2026-09-13 00:25 已上线）

由我实施（Codex 当时已停），提交 `d333e88`，部署 `haoqiu-vlm`（ModTime `2026-09-13 00:25:09`，Status Active，`{"selfTest":true}` 全绿）。

**改动落在 `cloudbase-backend/haoqiu-vlm/index.js`**（与线上基线对比仅 +77 行，其余零差异）：

1. 新增 `classifyProviderError(raw)`：识别 `Arrearage/overdue-payment/欠费` → `VLM_PROVIDER_ARREARS`、`401/403/Unauthorized/InvalidApiKey` → `VLM_PROVIDER_AUTH`、`429/RateLimit/Throttl` → `VLM_PROVIDER_RATE_LIMIT`。
2. 6 轮循环的 `catch` 里命中即 `break`，剩余轮次写入 `error: 已跳过（<code>，提前中止）`，**不再白跑**。
3. 终态判定改写（原来无条件 `status:"succeeded"`）：
   - `providerFatal` → `failed` + 对应 code/message；
   - `roundSummary.length > 0 && successCount === 0` → `failed` + `VLM_ALL_ROUNDS_FAILED`（message 带上第一条真实错误，截断 200 字）；
   - 其余 → `succeeded`，部分失败时附 `degraded: true` + `failed_rounds: [...]`，仍写 `text_result` 供排查。
4. **未改任何 prompt**（按需求要求）。

### 部署方式（可复用）
- 先 `getFunctionDownloadUrl` 下载线上包解压，**与本地 diff 确认基线一致**（本次 index.js 差异 = 仅我的改动，vlm-schema.js / package.json 零差异）。
- 线上包 **不含 `task-store.js` 且 index.js 不 require 它** → 那个文件目前无用，注意别误以为部署会漏。
- 本地 `npm ci` 会失败（package.json 与 lock 不同步，缺 `@ffmpeg-installer/*`）。**更稳的做法是直接用线上包里的 `node_modules`（74MB，含 ffmpeg 静态二进制）覆盖本地**，避免依赖版本漂移。
- `manageFunctions(updateFunctionCode, functionRootPath=<cloudbase-backend 父目录>)`，约 1 分钟生效；用 `listFunctions` 看 ModTime 确认。

### ⚠️ 尚未端到端验证失败态
`selfTest` 只证明代码能加载、ffmpeg 与 provider 正常，**没有验证失败分支**。当前百炼已充值，正常分析会成功，无法自然复现。要验证需构造失败场景（例如临时把 `VLM_API_KEY` 改成无效值跑一次再改回），涉及改线上 env + 读取明文 key，已向用户请示，未擅自执行。
