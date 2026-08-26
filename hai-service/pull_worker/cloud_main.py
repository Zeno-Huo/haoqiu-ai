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
        handled = worker.run_once()
        if not handled:
            time.sleep(config.idle_interval_seconds)


if __name__ == "__main__":
    main()
