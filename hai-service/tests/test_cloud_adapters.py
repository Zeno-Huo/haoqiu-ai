from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from pull_worker.cloud_adapters import CosSdkObjectStorage, HttpCloudBaseTaskApi
from pull_worker.cloud_config import CloudConfigError, CloudWorkerConfig


def valid_env() -> dict[str, str]:
    return {
        "HAOQIU_CLOUDBASE_ENV_ID": "haoqiu-ai-prod-d3g2cm2xn3255c273",
        "HAOQIU_TASK_API_BASE": "https://worker.example.test/gateway",
        "HAOQIU_TASK_API_TOKEN": "short-lived-worker-token",
        "HAOQIU_COS_BUCKET": "haoqiu-ai-media-1352817304",
        "HAOQIU_COS_REGION": "ap-shanghai",
        "HAOQIU_COS_SECRET_ID": "temporary-id",
        "HAOQIU_COS_SECRET_KEY": "temporary-key",
        "HAOQIU_COS_SESSION_TOKEN": "temporary-session-token",
        "HAOQIU_WORKER_ID": "hai-test",
    }


def test_config_requires_https_and_sts_session_token():
    env = valid_env()
    env["HAOQIU_TASK_API_BASE"] = "http://worker.example.test"
    with pytest.raises(CloudConfigError, match="HTTPS"):
        CloudWorkerConfig.from_env(env)

    env = valid_env()
    env["HAOQIU_COS_SESSION_TOKEN"] = ""
    with pytest.raises(CloudConfigError, match="临时凭据"):
        CloudWorkerConfig.from_env(env)

    config = CloudWorkerConfig.from_env(valid_env())
    rendered = repr(config)
    assert "short-lived-worker-token" not in rendered
    assert "temporary-key" not in rendered
    assert "temporary-session-token" not in rendered


def test_task_api_claim_progress_and_complete_use_safe_headers():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/claim"):
            return httpx.Response(
                200,
                json={
                    "task": {
                        "task_id": "task_01",
                        "lease_token": "lease_01",
                        "input_object_key": "inputs/user/task_01/source.mp4",
                        "output_object_key": "outputs/user/task_01/annotated.mp4",
                        "attempt": 1,
                        "max_attempts": 3,
                    }
                },
            )
        return httpx.Response(200, json={"accepted": True})

    config = CloudWorkerConfig.from_env(valid_env())
    client = httpx.Client(
        base_url=config.task_api_base,
        transport=httpx.MockTransport(handler),
        headers={
            "Authorization": f"Bearer {config.task_api_token}",
            "X-CloudBase-Env": config.cloudbase_env_id,
        },
    )
    api = HttpCloudBaseTaskApi(config, client=client)

    task = api.claim("hai-test", 120)
    assert task is not None and task.task_id == "task_01"
    assert api.report_progress("task_01", "lease_01", "detecting", 42, 18)
    assert api.complete(
        "task_01", "lease_01", {"artifact": {}}, "task_01:annotated-video:v1"
    )

    assert all(request.url.scheme == "https" for request in requests)
    assert requests[0].url.path == "/gateway/v1/worker/tasks/claim"
    assert requests[0].headers["authorization"] == "Bearer short-lived-worker-token"
    assert requests[1].url.path.endswith("/task_01/progress")
    assert requests[2].headers["idempotency-key"] == "task_01:annotated-video:v1"
    assert "short-lived-worker-token" not in requests[0].content.decode("utf-8")


class FakeCosClient:
    def __init__(self):
        self.download_args = None
        self.upload_args = None

    def download_file(self, **kwargs):
        self.download_args = kwargs
        Path(kwargs["DestFilePath"]).write_bytes(b"source-video")

    def upload_file(self, **kwargs):
        self.upload_args = kwargs
        return {"ETag": '"etag-01"'}


def test_cos_adapter_limits_prefixes_and_uses_private_bucket(tmp_path):
    config = CloudWorkerConfig.from_env(valid_env())
    client = FakeCosClient()
    storage = CosSdkObjectStorage(config, client=client)
    downloaded = tmp_path / "input.mp4"

    storage.download("inputs/user/task_01/source.mp4", downloaded)
    assert downloaded.read_bytes() == b"source-video"
    assert client.download_args["Bucket"] == "haoqiu-ai-media-1352817304"

    output = tmp_path / "annotated.mp4"
    output.write_bytes(b"annotated-video")
    stored = storage.upload(
        output, "outputs/user/task_01/annotated.mp4", "video/mp4"
    )
    assert stored.etag == "etag-01"
    assert client.upload_args["MAXThread"] == 2
    assert client.upload_args["ContentType"] == "video/mp4"

    with pytest.raises(ValueError, match="允许前缀"):
        storage.download("outputs/user/task_01/annotated.mp4", downloaded)
    with pytest.raises(ValueError, match="允许前缀"):
        storage.upload(output, "inputs/user/task_01/result.mp4", "video/mp4")
