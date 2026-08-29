from __future__ import annotations

import time

from .cloud_adapters import (
    CosSdkObjectStorage,
    HttpCloudBaseTaskApi,
    HttpsSignedUrlObjectStorage,
)
from .cloud_config import CloudWorkerConfig
from .local_api import HttpLocalDetectionApi
from .worker import PullWorker, WorkerConfig


def build_worker(config: CloudWorkerConfig) -> PullWorker:
    storage = (
        HttpsSignedUrlObjectStorage(config)
        if config.storage_mode == "signed_url"
        else CosSdkObjectStorage(config)
    )
    return PullWorker(
        task_api=HttpCloudBaseTaskApi(config),
        storage=storage,
        local_api=HttpLocalDetectionApi(config.local_api_base),
        config=WorkerConfig(
            worker_id=config.worker_id,
            work_dir=config.work_dir,
            lease_seconds=config.lease_seconds,
            heartbeat_interval_seconds=config.heartbeat_interval_seconds,
            poll_interval_seconds=config.poll_interval_seconds,
        ),
    )


def main() -> None:
    config = CloudWorkerConfig.from_env()
    worker = build_worker(config)
    while True:
        try:
            handled = worker.run_once()
        except Exception as exc:  # noqa: BLE001 - 守护进程必须永不自杀
            # 单个任务异常已在 run_once 内捕获；这里是兜底，防止任何
            # 边界异常（心跳线程、初始化竞态等）导致整个 worker 退出，
            # 否则 HAI 在烧钱却没人领任务。
            print(f"[worker] run_once crashed, keepalive: {exc}", flush=True)
            time.sleep(config.idle_interval_seconds)
            continue
        if not handled:
            time.sleep(config.idle_interval_seconds)


if __name__ == "__main__":
    main()
