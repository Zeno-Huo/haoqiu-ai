from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal


@dataclass(frozen=True)
class RemoteTask:
    task_id: str
    lease_token: str
    input_object_key: str
    output_object_key: str
    client_match_id: str | None = None
    attempt: int = 1
    max_attempts: int = 3
    # Signed URLs are ephemeral capabilities: keep them in memory only and out
    # of repr/logs/workspace state.
    input_download_url: str | None = field(default=None, repr=False)
    output_upload_url: str | None = field(default=None, repr=False)


@dataclass(frozen=True)
class StoredObject:
    object_key: str
    etag: str
    size_bytes: int


@dataclass(frozen=True)
class LocalJobSnapshot:
    job_id: str
    status: Literal["queued", "running", "succeeded", "failed"]
    progress: int = 0
    stage: str | None = None
    eta_seconds: int | None = None
    warnings: list[str] = field(default_factory=list)
    artifacts: dict[str, str] = field(default_factory=dict)
    diagnostics: dict[str, Any] | None = None
    error: dict[str, str] | None = None


@dataclass
class WorkspaceState:
    task_id: str
    input_object_key: str
    output_object_key: str
    stage: Literal["claimed", "downloaded", "submitted", "artifact_ready", "uploaded"]
    local_job_id: str | None = None
    uploaded_object: StoredObject | None = None
    local_result: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "WorkspaceState":
        uploaded = value.get("uploaded_object")
        return cls(
            task_id=value["task_id"],
            input_object_key=value["input_object_key"],
            output_object_key=value["output_object_key"],
            stage=value["stage"],
            local_job_id=value.get("local_job_id"),
            uploaded_object=StoredObject(**uploaded) if uploaded else None,
            local_result=value.get("local_result"),
        )
