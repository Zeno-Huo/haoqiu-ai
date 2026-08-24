from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

from .models import ErrorDetail, JobRecord, utc_now


class JobStore:
    """Small on-disk job store suitable for one process and one GPU worker."""

    def __init__(self, jobs_dir: Path):
        self.jobs_dir = jobs_dir
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._jobs: dict[str, JobRecord] = {}
        self._load_existing()

    def _load_existing(self) -> None:
        for metadata in self.jobs_dir.glob("job_*/job.json"):
            try:
                record = JobRecord.model_validate_json(metadata.read_text("utf-8"))
            except Exception:
                continue
            # An interrupted process cannot still own a queued or running job.
            if record.status in {"queued", "running"}:
                record.status = "failed"
                record.stage = "failed"
                record.error = ErrorDetail(
                    code="SERVICE_RESTARTED",
                    message="检测服务重启，任务已中断，请重新上传视频",
                )
                record.eta_seconds = None
                record.completed_at = utc_now()
                self._persist(record)
            self._jobs[record.job_id] = record

    def _persist(self, record: JobRecord) -> None:
        job_dir = self.jobs_dir / record.job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        target = job_dir / "job.json"
        temporary = job_dir / "job.json.tmp"
        temporary.write_text(record.model_dump_json(indent=2), encoding="utf-8")
        os.replace(temporary, target)

    def put(self, record: JobRecord) -> JobRecord:
        with self._lock:
            self._jobs[record.job_id] = record
            self._persist(record)
            return record.model_copy(deep=True)

    def get(self, job_id: str) -> JobRecord | None:
        with self._lock:
            record = self._jobs.get(job_id)
            return record.model_copy(deep=True) if record else None

    def update(self, job_id: str, **changes: Any) -> JobRecord:
        with self._lock:
            record = self._jobs[job_id]
            updated = record.model_copy(update=changes, deep=True)
            self._jobs[job_id] = updated
            self._persist(updated)
            return updated.model_copy(deep=True)

    def counts(self) -> tuple[int, int]:
        with self._lock:
            active = sum(job.status == "running" for job in self._jobs.values())
            queued = sum(job.status == "queued" for job in self._jobs.values())
            return active, queued
