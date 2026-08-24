from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field


JobStatus = Literal["queued", "running", "succeeded", "failed"]
JobStage = Literal["queued", "probing", "detecting", "rendering", "completed", "failed"]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class ErrorDetail(BaseModel):
    code: str
    message: str


class ModelInfo(BaseModel):
    name: str = "football-player-detection"
    version: str = "current-hai-weight"


class InputInfo(BaseModel):
    filename: str
    duration_seconds: float
    width: int
    height: int
    fps: float


class Diagnostics(BaseModel):
    processed_frames: int
    source_frames: int
    full_video_processed: bool
    classes_seen: list[str]
    frame_detections_by_class: dict[str, int]


class Artifacts(BaseModel):
    annotated_video_url: str


class JobRecord(BaseModel):
    job_id: str
    client_match_id: str | None = None
    status: JobStatus = "queued"
    progress: int = Field(default=0, ge=0, le=100)
    eta_seconds: int | None = Field(default=None, ge=0)
    stage: JobStage = "queued"
    created_at: str = Field(default_factory=utc_now)
    started_at: str | None = None
    completed_at: str | None = None
    model: ModelInfo | None = None
    input: InputInfo | None = None
    diagnostics: Diagnostics | None = None
    warnings: list[str] = Field(default_factory=list)
    artifacts: Artifacts | None = None
    error: ErrorDetail | None = None
    # Internal fields are excluded from HTTP responses by the route layer.
    source_path: str
    output_path: str


PUBLIC_JOB_EXCLUDES = {"source_path", "output_path"}
