# HAI Pull Worker 接入约定

该 worker 让 HAI 主动从 CloudBase 任务 API 认领工作，并通过 COS 下载/上传视频。现阶段只提供抽象适配接口和本地 fake 测试，**不包含腾讯云密钥、真实 CloudBase/COS SDK 或云资源操作**。

## 流程

1. 使用 `worker_id + lease_seconds` 原子认领最多一个任务；
2. 后台按租约周期续租，租约失效后不得提交状态；
3. 从 COS 适配器下载输入到确定性本地工作目录；
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

## COS 适配器必须保证

- 下载只接受任务 API 返回的 object key；
- 输出覆盖任务指定的确定性 object key；
- 上传返回 `object_key/etag/size_bytes`；
- 密钥来自 HAI 运行环境的临时角色或环境注入，不写入代码、日志或任务文档。

## 本地检测 API

`HttpLocalDetectionApi` 默认仅访问 `http://127.0.0.1:8000`。Pull worker 不要求把 GPU 服务端口开放公网。

## 本地低算力测试

```bash
cd hai-service
python -m pytest -q tests/test_pull_worker.py
```

测试全部使用内存 fake，不连接 CloudBase/COS、不调用模型或 GPU，覆盖：成功闭环与清理、检测失败重试、上传后恢复幂等、空队列。
