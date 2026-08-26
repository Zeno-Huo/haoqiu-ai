from __future__ import annotations

import hashlib
import os
import time
from pathlib import Path
from typing import Any

from pull_worker.models import LocalJobSnapshot, RemoteTask, StoredObject
from pull_worker.worker import PullWorker, WorkerConfig


class FakeTaskApi:
    def __init__(self, tasks: list[RemoteTask], complete_failures: int = 0):
        self.tasks = tasks
        self.complete_failures = complete_failures
        self.renewals = 0
        self.progress_updates: list[dict[str, Any]] = []
        self.completed: list[dict[str, Any]] = []
        self.failures: list[dict[str, Any]] = []

    def claim(self, worker_id: str, lease_seconds: int):
        return self.tasks.pop(0) if self.tasks else None

    def renew(self, task_id: str, lease_token: str, lease_seconds: int) -> bool:
        self.renewals += 1
        return True

    def report_progress(
        self, task_id, lease_token, stage, progress, eta_seconds
    ) -> bool:
        self.progress_updates.append(
            {"task_id": task_id, "stage": stage, "progress": progress, "eta": eta_seconds}
        )
        return True

    def complete(self, task_id, lease_token, result, idempotency_key):
        if self.complete_failures:
            self.complete_failures -= 1
            raise RuntimeError("temporary complete failure")
        self.completed.append(
            {"task_id": task_id, "result": result, "idempotency_key": idempotency_key}
        )
        return True

    def fail(self, task_id, lease_token, error_code, message, retryable):
        self.failures.append(
            {"task_id": task_id, "code": error_code, "retryable": retryable}
        )
        return True


class FakeStorage:
    def __init__(self, objects: dict[str, bytes]):
        self.objects = objects
        self.downloads = 0
        self.uploads = 0
        self.download_urls: list[str | None] = []
        self.upload_urls: list[str | None] = []

    def download(
        self, object_key: str, destination: Path, *, signed_url: str | None = None
    ) -> None:
        self.downloads += 1
        self.download_urls.append(signed_url)
        destination.write_bytes(self.objects[object_key])

    def upload(
        self,
        source: Path,
        object_key: str,
        content_type: str,
        *,
        signed_url: str | None = None,
    ) -> StoredObject:
        self.uploads += 1
        self.upload_urls.append(signed_url)
        data = source.read_bytes()
        self.objects[object_key] = data
        return StoredObject(
            object_key=object_key,
            etag=hashlib.md5(data, usedforsecurity=False).hexdigest(),
            size_bytes=len(data),
        )


class FakeLocalApi:
    def __init__(self, failed: bool = False):
        self.failed = failed
        self.creates = 0
        self.downloads = 0
        self.polls = 0

    def create_job(self, video: Path, client_match_id: str | None) -> str:
        self.creates += 1
        assert video.read_bytes() == b"source-video"
        return "local_01"

    def get_job(self, job_id: str) -> LocalJobSnapshot:
        self.polls += 1
        time.sleep(0.015)
        if self.failed:
            return LocalJobSnapshot(
                job_id=job_id,
                status="failed",
                error={"code": "VIDEO_DECODE_FAILED", "message": "bad video"},
            )
        if self.polls == 1:
            return LocalJobSnapshot(job_id=job_id, status="running", progress=50)
        return LocalJobSnapshot(
            job_id=job_id,
            status="succeeded",
            progress=100,
            warnings=["逐帧检测次数不代表唯一球员人数"],
            diagnostics={"processed_frames": 10, "full_video_processed": True},
        )

    def download_artifact(self, job_id: str, destination: Path) -> None:
        self.downloads += 1
        destination.write_bytes(b"annotated-video")


def make_task(attempt: int = 1) -> RemoteTask:
    return RemoteTask(
        task_id="remote_01",
        lease_token=f"lease_{attempt}",
        input_object_key="inputs/match.mp4",
        output_object_key="outputs/remote_01/annotated.mp4",
        client_match_id="m_01",
        attempt=attempt,
        max_attempts=3,
        input_download_url="https://cos.example/inputs/match.mp4?signature=input",
        output_upload_url="https://cos.example/outputs/remote_01/annotated.mp4?signature=output",
    )


def make_worker(tmp_path, task_api, storage, local_api):
    return PullWorker(
        task_api,
        storage,
        local_api,
        WorkerConfig(
            worker_id="hai-test",
            work_dir=tmp_path / "work",
            lease_seconds=1,
            heartbeat_interval_seconds=0.01,
            poll_interval_seconds=0.001,
            retry_delay_seconds=0.001,
        ),
    )


def test_pull_worker_success_and_cleanup(tmp_path):
    task_api = FakeTaskApi([make_task()])
    storage = FakeStorage({"inputs/match.mp4": b"source-video"})
    local_api = FakeLocalApi()
    worker = make_worker(tmp_path, task_api, storage, local_api)

    assert worker.run_once() is True
    assert len(task_api.completed) == 1
    assert task_api.completed[0]["idempotency_key"] == "remote_01:annotated-video:v1"
    assert storage.objects["outputs/remote_01/annotated.mp4"] == b"annotated-video"
    assert storage.download_urls == [make_task().input_download_url]
    assert storage.upload_urls == [make_task().output_upload_url]
    assert task_api.renewals > 0
    assert [update["progress"] for update in task_api.progress_updates] == [50, 100]
    assert list((tmp_path / "work").glob("task_*")) == []


def test_failed_detection_reports_retry_and_cleans(tmp_path):
    task_api = FakeTaskApi([make_task(attempt=1)])
    storage = FakeStorage({"inputs/match.mp4": b"source-video"})
    worker = make_worker(tmp_path, task_api, storage, FakeLocalApi(failed=True))

    assert worker.run_once() is True
    assert task_api.failures == [
        {"task_id": "remote_01", "code": "VIDEO_DECODE_FAILED", "retryable": True}
    ]
    assert list((tmp_path / "work").glob("task_*")) == []


def test_retry_resumes_after_upload_without_reprocessing(tmp_path):
    first = make_task(attempt=1)
    second = make_task(attempt=2)
    task_api = FakeTaskApi([first, second], complete_failures=3)
    storage = FakeStorage({"inputs/match.mp4": b"source-video"})
    local_api = FakeLocalApi()
    worker = make_worker(tmp_path, task_api, storage, local_api)

    assert worker.run_once() is True
    assert len(task_api.failures) == 1
    assert local_api.creates == 1
    assert storage.uploads == 1
    state_files = list((tmp_path / "work").glob("task_*/state.json"))
    assert len(state_files) == 1
    persisted = state_files[0].read_text("utf-8")
    assert "signature=input" not in persisted
    assert "signature=output" not in persisted

    assert worker.run_once() is True
    assert len(task_api.completed) == 1
    assert local_api.creates == 1
    assert storage.uploads == 1
    assert list((tmp_path / "work").glob("task_*")) == []


def test_empty_queue_returns_false(tmp_path):
    worker = make_worker(
        tmp_path,
        FakeTaskApi([]),
        FakeStorage({}),
        FakeLocalApi(),
    )
    assert worker.run_once() is False


def test_stale_workspace_is_removed_before_claim(tmp_path):
    worker = make_worker(
        tmp_path,
        FakeTaskApi([]),
        FakeStorage({}),
        FakeLocalApi(),
    )
    stale = tmp_path / "work" / "task_stale"
    stale.mkdir()
    (stale / "input.mp4").write_bytes(b"old")
    os.utime(stale, (0, 0))

    worker.cleanup_stale_workspaces()
    assert not stale.exists()
