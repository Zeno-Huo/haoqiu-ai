# HAI Pull Worker 接入约定

该 worker 让 HAI 主动从 CloudBase 任务 API 认领工作，并通过 COS 下载/上传视频。代码包含HTTPS任务API和COS SDK适配器，但**不包含腾讯云密钥或云资源操作**。

已确认资源：

- CloudBase env：`haoqiu-ai-prod-d3g2cm2xn3255c273`
- 私有 COS bucket：`haoqiu-ai-media-1352817304`
- COS region：`ap-shanghai`

## 流程

1. 使用 `worker_id + lease_seconds` 原子认领最多一个任务；
2. 后台按租约周期续租，租约失效后不得提交状态；
3. 生产优先使用claim响应中的短期COS签名URL，通过HTTPS下载输入到确定性本地工作目录；
4. 调用 `127.0.0.1:8000` 的现有 FastAPI 创建完整视频检测任务；
5. 轮询至完成，把受租约保护的进度/阶段/ETA回写任务 API，并下载带框 MP4；
6. 上传到任务指定的确定性 COS object key；
7. 使用固定幂等键完成远端任务；
8. 成功或明确业务失败后清理本地目录。

中间状态原子写入 `state.json`。若上传结果后、更新 CloudBase 前发生临时故障，下次认领同一任务会直接复用已上传结果，不重复消耗 GPU。未知临时故障保留工作目录；超过 `stale_workspace_seconds` 的遗留目录会在下一轮认领前清理。

## 任务 API 适配器必须保证

- `claim` 必须原子地从 `queued/retry_wait` 转为 `leased`，生成不可预测的 `lease_token`；
- `renew/report_progress/complete/fail` 必须同时校验 `task_id + lease_token + lease_expires_at`；
- `complete` 必须对 `idempotency_key` 幂等；重复请求返回同一完成结果；
- `fail(retryable=true)` 仅在 `attempt < max_attempts` 时重新排队，并建议使用退避时间；
- 任务文档只保存 COS object key、状态和诊断摘要，不保存临时下载 URL 或密钥。
- claim响应在使用`signed_url`模式时额外返回`input_download_url`和`output_upload_url`；二者不得写入任务文档、日志或本地`state.json`。
- 每次claim/重新认领都应即时签发新URL；下载URL至少覆盖下载窗口，上传URL必须覆盖最长完整视频处理窗口。若URL过期，worker按可重试失败退出，下一次认领使用新URL恢复，不复用过期URL。

`RemoteTask` 最小字段：

```json
{
  "task_id": "task_01",
  "lease_token": "opaque-random-token",
  "input_object_key": "inputs/user/task_01/source.mp4",
  "output_object_key": "outputs/user/task_01/annotated.mp4",
  "client_match_id": "m_01",
  "attempt": 1,
  "max_attempts": 3
}
```

生产claim响应还需在上述`task`对象中临时附加：

```json
{
  "input_download_url": "https://私有COS主机/inputs/...?签名参数",
  "output_upload_url": "https://私有COS主机/outputs/...?签名参数"
}
```

## COS 适配器必须保证

- 下载只接受任务 API 返回的 object key；
- 输出覆盖任务指定的确定性 object key；
- 上传返回 `object_key/etag/size_bytes`；
- 密钥来自 HAI 运行环境的临时角色或环境注入，不写入代码、日志或任务文档。

## HAI 环境变量

以下变量只在 HAI 运行环境注入，不提交 `.env`：

```bash
export HAOQIU_CLOUDBASE_ENV_ID=haoqiu-ai-prod-d3g2cm2xn3255c273
export HAOQIU_TASK_API_BASE=https://由后端提供的私有任务API域名
export HAOQIU_TASK_API_TOKEN=短期或受限worker凭据
export HAOQIU_COS_BUCKET=haoqiu-ai-media-1352817304
export HAOQIU_COS_REGION=ap-shanghai
export HAOQIU_STORAGE_MODE=signed_url
```

`signed_url`是生产默认模式，不需要在HAI注入COS SecretId/SecretKey。worker只在内存中使用claim返回的短期URL，不写日志或`state.json`；它会强制校验HTTPS、精确COS主机、URL路径与object key一致且包含签名参数，拒绝重定向。上传成功必须取得ETag，并仍以object key/ETag/size完成任务回报。

原STS模式保留作为受控回退方案。只有明确设置`HAOQIU_STORAGE_MODE=sts`时，才需要注入`HAOQIU_COS_SECRET_ID/HAOQIU_COS_SECRET_KEY/HAOQIU_COS_SESSION_TOKEN`三项临时凭据。配置校验会拒绝缺少SessionToken的STS配置。两种模式都限制输入/输出object key前缀。

真实适配器入口：

```bash
cd /root/haoqiu-service
source /root/haoqiu-env/bin/activate
python -m pull_worker.cloud_main
```

HAI只主动建立到任务API和COS的出站HTTPS连接；本地GPU检测仍访问`127.0.0.1:8000`，无需开放公网入站端口。

## 本地检测 API

`HttpLocalDetectionApi` 默认仅访问 `http://127.0.0.1:8000`。Pull worker 不要求把 GPU 服务端口开放公网。

## 本地低算力测试

```bash
cd hai-service
python -m pytest -q tests/test_pull_worker.py
```

测试全部使用内存 fake，不连接 CloudBase/COS、不调用模型或 GPU，覆盖：成功闭环与清理、检测失败重试、上传后恢复幂等、空队列。
