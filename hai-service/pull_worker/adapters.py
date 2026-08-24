from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol

from .models import LocalJobSnapshot, RemoteTask, StoredObject


class TaskApi(Protocol):
    """CloudBase adapter. Claim/renew/complete/fail must be lease-token conditional."""

    def claim(self, worker_id: str, lease_seconds: int) -> RemoteTask | None: ...

    def renew(self, task_id: str, lease_token: str, lease_seconds: int) -> bool: ...

    def report_progress(
        self,
        task_id: str,
        lease_token: str,
        stage: str,
        progress: int,
        eta_seconds: int | None,
    ) -> bool: ...

    def complete(
        self,
        task_id: str,
        lease_token: str,
        result: dict[str, Any],
        idempotency_key: str,
    ) -> bool: ...

    def fail(
        self,
        task_id: str,
        lease_token: str,
        error_code: str,
        message: str,
        retryable: bool,
    ) -> bool: ...


class ObjectStorage(Protocol):
    """COS adapter. Implementations must overwrite the deterministic output key safely."""

    def download(
        self, object_key: str, destination: Path, *, signed_url: str | None = None
    ) -> None: ...

    def upload(
        self,
        source: Path,
        object_key: str,
        content_type: str,
        *,
        signed_url: str | None = None,
    ) -> StoredObject: ...


class LocalDetectionApi(Protocol):
    def create_job(self, video: Path, client_match_id: str | None) -> str: ...

    def get_job(self, job_id: str) -> LocalJobSnapshot: ...

    def download_artifact(self, job_id: str, destination: Path) -> None: ...
