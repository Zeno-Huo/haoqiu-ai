#!/usr/bin/env python3
"""No-network, no-secret, no-GPU smoke check for the v0.3 worker wiring."""

from __future__ import annotations

import json

from pull_worker.cloud_adapters import (
    HttpCloudBaseTaskApi,
    HttpsSignedUrlObjectStorage,
)
from pull_worker.cloud_config import CloudWorkerConfig


def main() -> None:
    config = CloudWorkerConfig.from_env(
        {
            "HAOQIU_CLOUDBASE_ENV_ID": "haoqiu-ai-prod-d3g2cm2xn3255c273",
            "HAOQIU_TASK_API_BASE": "https://worker.invalid/gateway/",
            "HAOQIU_TASK_API_TOKEN": "smoke-placeholder-not-a-real-token",
            "HAOQIU_COS_BUCKET": "haoqiu-ai-media-1352817304",
            "HAOQIU_COS_REGION": "ap-shanghai",
            "HAOQIU_STORAGE_MODE": "signed_url",
            "HAOQIU_WORKER_ID": "hai-smoke",
            "HAOQIU_WORK_DIR": "/tmp/haoqiu-smoke-work",
        }
    )
    task_api = HttpCloudBaseTaskApi(config)
    storage = HttpsSignedUrlObjectStorage(config)
    try:
        assert config.storage_mode == "signed_url"
        assert config.expected_cos_host == (
            "haoqiu-ai-media-1352817304.cos.ap-shanghai.myqcloud.com"
        )
        assert task_api.config.task_api_base == "https://worker.invalid/gateway"
        assert storage.config.cos_bucket == "haoqiu-ai-media-1352817304"
        rendered = repr(config)
        assert "smoke-placeholder-not-a-real-token" not in rendered
        print(
            json.dumps(
                {
                    "status": "ok",
                    "network_requests": 0,
                    "gpu_jobs": 0,
                    "storage_mode": config.storage_mode,
                    "expected_cos_host": config.expected_cos_host,
                    "worker_routes": [
                        "POST v1/worker/tasks/claim",
                        "POST v1/worker/tasks/{task_id}/renew",
                        "POST v1/worker/tasks/{task_id}/progress",
                        "POST v1/worker/tasks/{task_id}/complete",
                        "POST v1/worker/tasks/{task_id}/fail",
                    ],
                },
                ensure_ascii=False,
            )
        )
    finally:
        task_api.client.close()
        storage.client.close()


if __name__ == "__main__":
    main()

