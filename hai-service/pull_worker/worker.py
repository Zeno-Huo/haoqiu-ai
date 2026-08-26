from __future__ import annotations

import hashlib
import json
import shutil
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, TypeVar

from .adapters import LocalDetectionApi, ObjectStorage, TaskApi
from .models import LocalJobSnapshot, RemoteTask, WorkspaceState


T = TypeVar("T")


class LeaseLost(RuntimeError):
    pass


class RemoteJobFailed(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class WorkerConfig:
    worker_id: str
    work_dir: Path
    lease_seconds: int = 120
    heartbeat_interval_seconds: float = 30
    poll_interval_seconds: float = 2
    operation_attempts: int = 3
    retry_delay_seconds: float = 1
    stale_workspace_seconds: int = 7 * 24 * 60 * 60


class LeaseHeartbeat:
    def __init__(self, task_api: TaskApi, task: RemoteTask, config: WorkerConfig):
        self.task_api = task_api
        self.task = task
        self.config = config
        self._stop = threading.Event()
        self._lost = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_success = time.monotonic()

    def __enter__(self) -> "LeaseHeartbeat":
        self._thread = threading.Thread(target=self._run, name="lease-heartbeat", daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *_: object) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=max(1.0, self.config.heartbeat_interval_seconds + 1))

    def ensure_owned(self) -> None:
        if self._lost.is_set():
            raise LeaseLost("任务租约已失效，停止提交结果")

    def _run(self) -> None:
        interval = min(
            max(0.01, self.config.heartbeat_interval_seconds),
            max(0.01, self.config.lease_seconds / 3),
        )
        while not self._stop.wait(interval):
            try:
                renewed = self.task_api.renew(
                    self.task.task_id, self.task.lease_token, self.config.lease_seconds
                )
            except Exception:
                if time.monotonic() - self._last_success >= self.config.lease_seconds:
                    self._lost.set()
                    return
                continue
            if not renewed:
                self._lost.set()
                return
            self._last_success = time.monotonic()


class PullWorker:
    def __init__(
        self,
        task_api: TaskApi,
        storage: ObjectStorage,
        local_api: LocalDetectionApi,
        config: WorkerConfig,
    ):
        self.task_api = task_api
        self.storage = storage
        self.local_api = local_api
        self.config = config
        self.config.work_dir.mkdir(parents=True, exist_ok=True)

    def run_once(self) -> bool:
        """Claim and handle at most one task. Returns False when the queue is empty."""
        self.cleanup_stale_workspaces()
        task = self.task_api.claim(self.config.worker_id, self.config.lease_seconds)
        if task is None:
            return False
        task_dir = self._task_dir(task.task_id)
        try:
            with LeaseHeartbeat(self.task_api, task, self.config) as lease:
                self._process(task, task_dir, lease)
        except LeaseLost:
            # Never mutate remote state using an invalid lease token.
            self._cleanup(task_dir)
        except RemoteJobFailed as exc:
            retryable = task.attempt < task.max_attempts
            self._safe_fail(task, exc.code, exc.message, retryable)
            self._cleanup(task_dir)
        except Exception as exc:
            # Preserve deterministic workspace state: a later lease can resume
            # after download, local inference, artifact creation, or COS upload.
            retryable = task.attempt < task.max_attempts
            self._safe_fail(task, "WORKER_OPERATION_FAILED", str(exc), retryable)
            if not retryable:
                self._cleanup(task_dir)
        return True

    def _process(self, task: RemoteTask, task_dir: Path, lease: LeaseHeartbeat) -> None:
        task_dir.mkdir(parents=True, exist_ok=True)
        state = self._load_or_initialize_state(task, task_dir)
        input_path = task_dir / "input.mp4"
        artifact_path = task_dir / "annotated.mp4"

        if state.stage == "uploaded" and state.uploaded_object:
            self._complete(task, state, lease)
            self._cleanup(task_dir)
            return

        if state.stage == "claimed" or not input_path.is_file():
            self._retry(
                lambda: self.storage.download(
                    task.input_object_key,
                    input_path,
                    signed_url=task.input_download_url,
                ),
                lease,
            )
            lease.ensure_owned()
            state.stage = "downloaded"
            self._save_state(task_dir, state)

        if state.local_job_id is None:
            state.local_job_id = self._retry(
                lambda: self.local_api.create_job(input_path, task.client_match_id), lease
            )
            state.stage = "submitted"
            self._save_state(task_dir, state)

        snapshot = self._wait_for_local_job(task, state.local_job_id, lease)
        if snapshot.status == "failed":
            error = snapshot.error or {}
            raise RemoteJobFailed(
                error.get("code", "LOCAL_DETECTION_FAILED"),
                error.get("message", "本机足球检测任务失败"),
            )
        state.local_result = self._result_payload(snapshot)

        if not artifact_path.is_file():
            self._retry(
                lambda: self.local_api.download_artifact(state.local_job_id or "", artifact_path),
                lease,
            )
        lease.ensure_owned()
        state.stage = "artifact_ready"
        self._save_state(task_dir, state)

        uploaded = self._retry(
            lambda: self.storage.upload(
                artifact_path,
                task.output_object_key,
                "video/mp4",
                signed_url=task.output_upload_url,
            ),
            lease,
        )
        lease.ensure_owned()
        state.uploaded_object = uploaded
        state.stage = "uploaded"
        self._save_state(task_dir, state)

        self._complete(task, state, lease)
        self._cleanup(task_dir)

    def _complete(
        self, task: RemoteTask, state: WorkspaceState, lease: LeaseHeartbeat
    ) -> None:
        lease.ensure_owned()
        if not state.uploaded_object:
            raise RuntimeError("任务缺少已上传结果")
        result = {
            "artifact": {
                "object_key": state.uploaded_object.object_key,
                "etag": state.uploaded_object.etag,
                "size_bytes": state.uploaded_object.size_bytes,
                "content_type": "video/mp4",
            },
            "detection": state.local_result or {},
            "model": {"name": "football-player-detection", "version": "YOLOv8"},
        }
        accepted = self._retry(
            lambda: self.task_api.complete(
                task.task_id,
                task.lease_token,
                result,
                idempotency_key=f"{task.task_id}:annotated-video:v1",
            ),
            lease,
        )
        if not accepted:
            raise LeaseLost("远端拒绝完成任务，租约可能已转移")

    def _wait_for_local_job(
        self, task: RemoteTask, local_job_id: str, lease: LeaseHeartbeat
    ) -> LocalJobSnapshot:
        while True:
            snapshot = self._retry(lambda: self.local_api.get_job(local_job_id), lease)
            lease.ensure_owned()
            # The cloud API only accepts stage in {"probing", "detecting", "rendering"}.
            # The local service also reports "queued"/"completed"/"failed" — map those
            # to the nearest valid stage so the first/last progress reports are accepted.
            raw_stage = snapshot.stage or snapshot.status
            stage = raw_stage if raw_stage in ("probing", "detecting", "rendering") else (
                "rendering" if raw_stage == "completed" else "probing"
            )
            # Cloud API requires progress in [0, 99]; the local service reports 100
            # on completion — clamp it (the complete call marks 100 server-side).
            progress = max(0, min(99, int(snapshot.progress or 0)))
            reported = self._retry(
                lambda: self.task_api.report_progress(
                    task.task_id,
                    task.lease_token,
                    stage,
                    progress,
                    snapshot.eta_seconds,
                ),
                lease,
            )
            if not reported:
                raise LeaseLost("远端拒绝进度更新，租约可能已转移")
            if snapshot.status in {"succeeded", "failed"}:
                return snapshot
            time.sleep(self.config.poll_interval_seconds)

    def _retry(self, operation: Callable[[], T], lease: LeaseHeartbeat) -> T:
        last_error: Exception | None = None
        for attempt in range(self.config.operation_attempts):
            lease.ensure_owned()
            try:
                return operation()
            except LeaseLost:
                raise
            except Exception as exc:
                last_error = exc
                if attempt + 1 < self.config.operation_attempts:
                    time.sleep(self.config.retry_delay_seconds)
        assert last_error is not None
        raise last_error

    def _load_or_initialize_state(
        self, task: RemoteTask, task_dir: Path
    ) -> WorkspaceState:
        state_path = task_dir / "state.json"
        if state_path.is_file():
            try:
                state = WorkspaceState.from_dict(json.loads(state_path.read_text("utf-8")))
                if (
                    state.task_id == task.task_id
                    and state.input_object_key == task.input_object_key
                    and state.output_object_key == task.output_object_key
                ):
                    return state
            except Exception:
                pass
            self._cleanup(task_dir)
            task_dir.mkdir(parents=True, exist_ok=True)
        state = WorkspaceState(
            task_id=task.task_id,
            input_object_key=task.input_object_key,
            output_object_key=task.output_object_key,
            stage="claimed",
        )
        self._save_state(task_dir, state)
        return state

    @staticmethod
    def _save_state(task_dir: Path, state: WorkspaceState) -> None:
        target = task_dir / "state.json"
        temporary = task_dir / "state.json.tmp"
        temporary.write_text(
            json.dumps(state.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8"
        )
        temporary.replace(target)

    def _safe_fail(
        self, task: RemoteTask, code: str, message: str, retryable: bool
    ) -> None:
        try:
            self.task_api.fail(
                task.task_id,
                task.lease_token,
                code,
                message[:500],
                retryable,
            )
        except Exception:
            pass

    def cleanup_stale_workspaces(self) -> None:
        cutoff = time.time() - self.config.stale_workspace_seconds
        for path in self.config.work_dir.glob("task_*"):
            try:
                if path.is_dir() and path.stat().st_mtime < cutoff:
                    self._cleanup(path)
            except OSError:
                continue

    def _task_dir(self, task_id: str) -> Path:
        digest = hashlib.sha256(task_id.encode("utf-8")).hexdigest()[:24]
        return self.config.work_dir / f"task_{digest}"

    @staticmethod
    def _cleanup(path: Path) -> None:
        shutil.rmtree(path, ignore_errors=True)

    @staticmethod
    def _result_payload(snapshot: LocalJobSnapshot) -> dict[str, Any]:
        return {
            "local_job_id": snapshot.job_id,
            "warnings": snapshot.warnings,
            "diagnostics": snapshot.diagnostics,
        }
