# 好球Ai CloudBase 最小任务后端

单个 Node.js HTTP 云函数，负责私有 COS 直传、异步检测任务和 HAI pull worker 租约。这里只包含本地代码和部署模板；不会创建或修改云资源，也不包含真实密钥。

已固定的非秘密资源标识：

- CloudBase env：`haoqiu-ai-prod-d3g2cm2xn3255c273`
- COS bucket：`haoqiu-ai-media-1352817304`
- COS region：`ap-shanghai`

## 安全边界

- 对象 key 只由服务端生成：`inputs/{user}/{task}/...`、`outputs/{user}/{task}/...`。
- 上传/下载 URL 最长 15 分钟，COS 桶继续保持私有；数据库不保存签名 URL。
- 生产环境拒绝匿名。测试身份头 `x-test-user-id` 只有在非 production 且 `ALLOW_TEST_IDENTITY=true` 时有效。
- worker 端点统一验证 `Authorization: Bearer ...`，token 从运行环境注入。生产建议在 API 网关再加机器身份/mTLS 或短期 OIDC；当前 token 仅是 MVP 服务身份抽象。
- COS 凭据只从函数运行环境读取。不要把永久密钥写入 `.env`、模板、日志或前端；生产优先使用运行角色/临时会话凭据，或由密钥管理服务注入。

## API

前端：

1. `POST /api/v1/uploads/ticket`，JSON：`filename`、`content_type`、`size_bytes`、`duration_seconds`、可选 `client_match_id`。严格限制 300MB、15 分钟、MP4/MOV。
2. 客户端按响应中的 `PUT` URL 直接上传到私有 COS。
3. `POST /api/v1/uploads/{upload_id}/confirm`。后端 HEAD 校验对象及精确大小，并幂等创建 queued 任务。
4. `GET /api/v1/detection-jobs/{task_id}` 查询自己的任务。
5. `GET /api/v1/detection-jobs/{task_id}/artifacts/annotated-video` 在成功后签发短期 GET URL。

worker（均需服务身份）：

- `POST /worker/v1/tasks/claim`：`worker_id`、`lease_seconds`
- `POST /worker/v1/tasks/renew`：`task_id`、`lease_token`、`lease_seconds`
- `POST /worker/v1/tasks/progress`：`task_id`、`lease_token`、`progress`、`stage`、可选 `eta_seconds`
- `POST /worker/v1/tasks/complete`：租约字段、固定 `idempotency_key`、`output {object_key,etag,size_bytes}`，可带诊断摘要
- `POST /worker/v1/tasks/fail`：租约字段、`retryable`、`error {code,message}`

claim、续租、进度和终态更新均使用数据库事务。所有 worker 写入都校验 `task_id + lease_token + lease_expires_at`；完成接口对幂等键重放返回相同结果。可重试失败使用指数退避，最多三次。

任务记录包含 `raw_lifecycle.delete_after` 和成功后的 `result_lifecycle.delete_after`。它们是清理依据，不会自动删除 COS 对象；上线前应在 COS 配置与 `inputs/`、`outputs/` 对应的生命周期规则，或增加定时清理函数。

## 本地验证

```bash
npm install
npm run check
```

测试只使用内存 repository/COS fake，不访问腾讯云。复制 `.env.example` 仅供本地设置，`.env*` 已被忽略。

## 部署前清单（本仓库不执行）

1. 创建 `haoqiu_uploads`、`haoqiu_detection_tasks` 集合。
2. 为任务集合建立索引：`status + available_at + created_at`，以及 `status + lease_expires_at + created_at`。
3. 配置 HTTP 触发器，并确认平台将已验证用户身份传到 `context.auth` 或 `event.userInfo`；若实际字段不同，只替换 `src/auth.ts` 的身份适配层。
4. 通过 Secret Manager/运行环境注入 worker token 与 COS 运行凭据，保持 `ALLOW_TEST_IDENTITY=false`。
5. 将 `cloudbaserc.template.json` 复制为部署配置，确认运行时版本后再人工部署。
6. 配置 COS 生命周期规则和最小权限：函数仅允许指定桶的 `inputs/` PUT/HEAD 与 `outputs/` GET；HAI 则只读 `inputs/`、只写 `outputs/`。

`cloudbaserc.template.json` 故意不含密钥，也不会自动部署。
