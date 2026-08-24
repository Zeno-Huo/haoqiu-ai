# 好球Ai HAI 检测服务

这是第一个真实足球检测模型的最小异步服务。服务只提供逐帧候选检测和带框视频，**不提供**唯一球员人数、身份、控球、传球、抢断或战术结论。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `HAOQIU_MODEL_PATH` | `/root/haoqiu-sports/examples/soccer/data/football-player-detection.pt` | 已有 YOLO 权重 |
| `HAOQIU_JOBS_DIR` | `/root/haoqiu-service/jobs` | 上传、状态与产物目录 |
| `HAOQIU_DEVICE` | `0` | Ultralytics 推理设备 |
| `HAOQIU_CONFIDENCE` | `0.25` | 检测置信度 |
| `HAOQIU_HOST` | `127.0.0.1` | 监听地址，v0.1 不应直接开放公网 |
| `HAOQIU_PORT` | `8000` | 监听端口 |

上传限制：MP4/MOV、300MB、15分钟。时长在单 GPU worker 开始探测视频时校验；超限任务会以 `VIDEO_TOO_LONG` 失败。

## 在 HAI 上部署

代码同步到 `/root/haoqiu-service` 后，复用现有环境：

```bash
cd /root/haoqiu-service
source /root/haoqiu-env/bin/activate
python -m pip install -r requirements.txt
chmod +x start.sh
./start.sh
```

如果现有环境已经包含这些依赖，可先直接启动，不必重复安装。默认只监听 `127.0.0.1:8000`。

健康检查：

```bash
curl http://127.0.0.1:8000/health
```

创建任务：

```bash
curl -F 'video=@/path/to/match.mp4' \
  -F 'client_match_id=m_01' \
  http://127.0.0.1:8000/api/v1/detection-jobs
```

## 本地低算力契约测试

测试使用假的 runner，不加载 PyTorch、模型或 GPU：

```bash
cd hai-service
python -m pytest -q
```

## 编码要求

输出固定为 H.264 + `yuv420p` 的 MP4，供浏览器播放。运行环境的 PyAV/FFmpeg 必须包含 `libx264`；缺失时任务会明确失败为 `H264_ENCODER_UNAVAILABLE`，不会伪装成功。

任务由单个 `asyncio.Queue` 串行执行，保证同一时间只有一个 GPU 推理。任务元数据和视频均保存在 `HAOQIU_JOBS_DIR`，服务重启后可继续查询已完成任务；被重启中断的任务会标记失败并要求重新上传。
