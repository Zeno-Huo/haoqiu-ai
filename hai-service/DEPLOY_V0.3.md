# 好球Ai HAI v0.3 最小部署清单

本清单只描述生产接通准备，不执行部署、不创建GPU任务、不包含密钥。v0.3 使用 HAI 主动拉取任务的架构，HAI 不开放公网入站端口。

## 1. 固定资源与网络边界

- CloudBase env：`haoqiu-ai-prod-d3g2cm2xn3255c273`
- 私有 COS bucket：`haoqiu-ai-media-1352817304`
- COS region：`ap-shanghai`
- COS 主机：`haoqiu-ai-media-1352817304.cos.ap-shanghai.myqcloud.com`
- 本机检测 API：`http://127.0.0.1:8000`
- HAI 外部网络：只需出站 HTTPS 到 CloudBase 任务 API 与上述 COS 主机
- 生产默认存储模式：`signed_url`；HAI 不需要 COS SecretId/SecretKey

## 2. HAI 本机检测服务环境变量

这些变量不含云密钥，可放入仅 root 可读的服务环境文件：

```bash
HAOQIU_MODEL_PATH=/root/haoqiu-sports/examples/soccer/data/football-player-detection.pt
HAOQIU_JOBS_DIR=/root/haoqiu-service/jobs
HAOQIU_DEVICE=0
HAOQIU_CONFIDENCE=0.25
HAOQIU_HOST=127.0.0.1
HAOQIU_PORT=8000
```

启动入口：

```bash
cd /root/haoqiu-service
source /root/haoqiu-env/bin/activate
./start.sh
```

生产进程管理器必须保持 `--workers 1`，避免同一GPU并发加载多个模型。

## 3. Pull worker 环境变量

必须注入：

```bash
HAOQIU_CLOUDBASE_ENV_ID=haoqiu-ai-prod-d3g2cm2xn3255c273
HAOQIU_TASK_API_BASE=https://实际CloudBase任务API基础地址/
HAOQIU_TASK_API_TOKEN=短期或受限worker凭据
HAOQIU_COS_BUCKET=haoqiu-ai-media-1352817304
HAOQIU_COS_REGION=ap-shanghai
HAOQIU_STORAGE_MODE=signed_url
HAOQIU_WORKER_ID=hai-t4-01
```

建议显式设置：

```bash
HAOQIU_LOCAL_API_BASE=http://127.0.0.1:8000
HAOQIU_WORK_DIR=/root/haoqiu-worker/worker-work
HAOQIU_LEASE_SECONDS=120
HAOQIU_HEARTBEAT_INTERVAL_SECONDS=30
HAOQIU_POLL_INTERVAL_SECONDS=2
HAOQIU_IDLE_INTERVAL_SECONDS=5
```

`signed_url` 模式不要设置 `HAOQIU_COS_SECRET_ID/HAOQIU_COS_SECRET_KEY/HAOQIU_COS_SESSION_TOKEN`。原 STS 模式只作为受控回退方案保留。

Pull worker 启动入口：

```bash
cd /root/haoqiu-service
source /root/haoqiu-env/bin/activate
python -m pull_worker.cloud_main
```

## 4. Worker API 精确路径

所有路径相对 `HAOQIU_TASK_API_BASE`，基础地址应以 `/` 结束且不得包含 query/fragment：

```text
POST v1/worker/tasks/claim
POST v1/worker/tasks/{task_id}/renew
POST v1/worker/tasks/{task_id}/progress
POST v1/worker/tasks/{task_id}/complete
POST v1/worker/tasks/{task_id}/fail
```

所有请求携带：

```text
Authorization: Bearer <HAOQIU_TASK_API_TOKEN>
X-CloudBase-Env: haoqiu-ai-prod-d3g2cm2xn3255c273
Content-Type: application/json
```

`complete` 额外携带固定 `Idempotency-Key`。claim 的 `task` 包装必须返回 `input_download_url` 与 `output_upload_url`。两条URL必须是短期私有COS HTTPS URL，路径分别精确对应任务的 input/output object key；PUT签名需允许 `Content-Type: video/mp4`，有效期需覆盖完整视频处理窗口。

## 5. 健康检查（不创建GPU任务）

### 5.1 文件与GPU运行时

以下检查只读，不执行模型推理：

```bash
test -r "$HAOQIU_MODEL_PATH"
python -c 'import torch; print({"cuda_available": torch.cuda.is_available(), "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None})'
```

### 5.2 本机检测服务

```bash
curl --fail --silent http://127.0.0.1:8000/health
```

预期 `status=ok`、`gpu_available=true`。模型采用懒加载，因此首次真实任务前 `model_loaded=false` 可以接受；健康检查本身不得为使其变成 true 而上传视频。

### 5.3 CloudBase 后端

在后端提供不认领任务的只读健康路由后执行：

```bash
curl --fail --silent "${HAOQIU_TASK_API_BASE%/}/health"
```

健康响应至少确认服务存活与配置版本，不得返回token、签名URL或COS凭据。禁止把 `claim` 当健康检查，因为它会改变任务租约。

### 5.4 Pull worker

Pull worker 不监听网络端口。生产使用进程管理器检查进程存活和退出码；不要为了探活调用claim。真实任务接通前，使用下一节的无密钥 smoke。

## 6. 无密钥、无网络、无GPU smoke

脚本只构造假 HTTPS 地址和占位token，实例化配置与 signed-url 适配器，不发网络请求、不访问COS、不运行模型：

```bash
cd /root/haoqiu-service
source /root/haoqiu-env/bin/activate
python scripts/smoke_no_secrets.py
```

预期输出包含：

```json
{"status":"ok","network_requests":0,"gpu_jobs":0,"storage_mode":"signed_url"}
```

本地完整 fake 契约测试同样不需要云密钥或GPU：

```bash
python -m pytest -q tests/test_cloud_adapters.py tests/test_pull_worker.py
```

## 7. 首个真实任务前人工门槛

- [ ] CloudBase 后端 worker 路径与 HAI 契约一致，claim 响应有外层 `task`
- [ ] claim 每次即时签发新的 input GET URL 与 output PUT URL，不持久化URL
- [ ] output URL 有效期覆盖最长处理窗口，PUT响应可读取 `ETag`
- [ ] worker token 已在后端和HAI通过受限环境变量注入，未进入代码、Git或日志
- [ ] HAI 未配置永久COS密钥，`HAOQIU_STORAGE_MODE=signed_url`
- [ ] CloudBase/COS 生命周期与本地陈旧工作目录清理策略已确认
- [ ] 检测服务仅监听 `127.0.0.1:8000`，安全组未为它开放公网端口
- [ ] 本页全部无密钥 smoke 与只读健康检查通过
- [ ] 首个真实任务由用户明确批准后再认领，避免意外产生GPU费用

