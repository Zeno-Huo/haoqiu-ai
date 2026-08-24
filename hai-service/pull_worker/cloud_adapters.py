from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

from .cloud_config import CloudWorkerConfig
from .models import RemoteTask, StoredObject


class CloudTaskApiError(RuntimeError):
    pass


class HttpCloudBaseTaskApi:
    """HTTPS adapter for a private CloudBase HTTP function/task gateway."""

    def __init__(
        self,
        config: CloudWorkerConfig,
        client: httpx.Client | None = None,
    ):
        self.config = config
        self.client = client or httpx.Client(
            base_url=config.task_api_base,
            timeout=httpx.Timeout(30, connect=10),
            headers={
                "Authorization": f"Bearer {config.task_api_token}",
                "X-CloudBase-Env": config.cloudbase_env_id,
                "User-Agent": "haoqiu-hai-worker/0.1",
            },
        )

    def claim(self, worker_id: str, lease_seconds: int) -> RemoteTask | None:
        response = self.client.post(
            "v1/worker/tasks/claim",
            json={"worker_id": worker_id, "lease_seconds": lease_seconds},
        )
        if response.status_code == 204:
            return None
        self._require_success(response, "认领任务")
        payload = response.json().get("task")
        if not isinstance(payload, dict):
            raise CloudTaskApiError("任务API响应缺少task")
        try:
            return RemoteTask(
                task_id=str(payload["task_id"]),
                lease_token=str(payload["lease_token"]),
                input_object_key=str(payload["input_object_key"]),
                output_object_key=str(payload["output_object_key"]),
                client_match_id=payload.get("client_match_id"),
                attempt=int(payload.get("attempt", 1)),
                max_attempts=int(payload.get("max_attempts", 3)),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise CloudTaskApiError("任务API返回的任务字段不完整") from exc

    def renew(self, task_id: str, lease_token: str, lease_seconds: int) -> bool:
        return self._conditional_post(
            task_id,
            "renew",
            {"lease_token": lease_token, "lease_seconds": lease_seconds},
        )

    def report_progress(
        self,
        task_id: str,
        lease_token: str,
        stage: str,
        progress: int,
        eta_seconds: int | None,
    ) -> bool:
        return self._conditional_post(
            task_id,
            "progress",
            {
                "lease_token": lease_token,
                "stage": stage,
                "progress": progress,
                "eta_seconds": eta_seconds,
            },
        )

    def complete(
        self,
        task_id: str,
        lease_token: str,
        result: dict[str, Any],
        idempotency_key: str,
    ) -> bool:
        return self._conditional_post(
            task_id,
            "complete",
            {"lease_token": lease_token, "result": result},
            headers={"Idempotency-Key": idempotency_key},
        )

    def fail(
        self,
        task_id: str,
        lease_token: str,
        error_code: str,
        message: str,
        retryable: bool,
    ) -> bool:
        return self._conditional_post(
            task_id,
            "fail",
            {
                "lease_token": lease_token,
                "error": {"code": error_code, "message": message},
                "retryable": retryable,
            },
        )

    def _conditional_post(
        self,
        task_id: str,
        action: str,
        payload: dict[str, Any],
        headers: dict[str, str] | None = None,
    ) -> bool:
        response = self.client.post(
            f"v1/worker/tasks/{quote(task_id, safe='')}/{action}",
            json=payload,
            headers=headers,
        )
        if response.status_code in {404, 409, 410, 412}:
            return False
        self._require_success(response, f"更新任务{action}")
        body = response.json()
        return bool(body.get("accepted", True))

    @staticmethod
    def _require_success(response: httpx.Response, operation: str) -> None:
        if response.is_success:
            return
        # Do not include response bodies: a misconfigured gateway could echo credentials.
        raise CloudTaskApiError(f"{operation}失败：HTTP {response.status_code}")


class CosSdkObjectStorage:
    """Private COS adapter using short-lived STS credentials and HTTPS only."""

    def __init__(self, config: CloudWorkerConfig, client: Any | None = None):
        self.config = config
        if client is None:
            try:
                from qcloud_cos import CosConfig, CosS3Client
            except ImportError as exc:
                raise RuntimeError("缺少cos-python-sdk-v5依赖") from exc
            cos_config = CosConfig(
                Region=config.cos_region,
                SecretId=config.cos_secret_id,
                SecretKey=config.cos_secret_key,
                Token=config.cos_session_token,
                Scheme="https",
            )
            client = CosS3Client(cos_config)
        self.client = client

    def download(self, object_key: str, destination: Path) -> None:
        self._require_prefix(object_key, self.config.cos_input_prefix, "输入")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".part")
        temporary.unlink(missing_ok=True)
        try:
            self.client.download_file(
                Bucket=self.config.cos_bucket,
                Key=object_key,
                DestFilePath=str(temporary),
            )
            if not temporary.is_file() or temporary.stat().st_size == 0:
                raise RuntimeError("COS下载结果为空")
            temporary.replace(destination)
        except Exception:
            temporary.unlink(missing_ok=True)
            raise

    def upload(self, source: Path, object_key: str, content_type: str) -> StoredObject:
        self._require_prefix(object_key, self.config.cos_output_prefix, "输出")
        if not source.is_file() or source.stat().st_size == 0:
            raise RuntimeError("待上传结果文件不存在或为空")
        response = self.client.upload_file(
            Bucket=self.config.cos_bucket,
            LocalFilePath=str(source),
            Key=object_key,
            PartSize=10,
            MAXThread=2,
            ContentType=content_type,
        )
        etag = str(response.get("ETag", "")).strip('"')
        if not etag:
            raise RuntimeError("COS上传响应缺少ETag")
        return StoredObject(
            object_key=object_key,
            etag=etag,
            size_bytes=source.stat().st_size,
        )

    @staticmethod
    def _require_prefix(object_key: str, prefix: str, label: str) -> None:
        if not object_key.startswith(prefix) or object_key.startswith("/") or ".." in object_key.split("/"):
            raise ValueError(f"{label}COS object key不在允许前缀内")
