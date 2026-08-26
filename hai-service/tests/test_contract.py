from __future__ import annotations

import shutil
import os
import tempfile
import time
from pathlib import Path

from fastapi.testclient import TestClient

# app.main exposes the production ASGI app at import time. Keep its default store
# in a disposable directory during tests, before importing that module.
os.environ.setdefault("HAOQIU_JOBS_DIR", tempfile.mkdtemp(prefix="haoqiu-test-import-"))

from app.config import Settings
from app.main import create_app
from app.models import Diagnostics, InputInfo, ModelInfo
from app.runner import (
    ProcessingError,
    ProcessingResult,
    validate_full_decode,
    validate_video_metadata,
)
from app.store import JobStore
from app.models import JobRecord


class FakeRunner:
    gpu_available = False
    model_loaded = True

    def process(self, source: Path, output: Path, progress):
        progress("detecting", 50, 3)
        time.sleep(0.15)
        shutil.copyfile(source, output)
        return ProcessingResult(
            input_info=InputInfo(
                filename=source.name,
                duration_seconds=1.0,
                width=320,
                height=180,
                fps=25,
            ),
            diagnostics=Diagnostics(
                processed_frames=25,
                source_frames=25,
                full_video_processed=True,
                classes_seen=["player"],
                frame_detections_by_class={"player": 17},
            ),
            model=ModelInfo(),
        )


def test_job_contract_without_gpu(tmp_path):
    settings = Settings(model_path=tmp_path / "unused.pt", jobs_dir=tmp_path / "jobs")
    app = create_app(settings=settings, runner=FakeRunner())
    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["gpu_available"] is False

        created = client.post(
            "/api/v1/detection-jobs",
            files={"video": ("match.mp4", b"fake-mp4", "video/mp4")},
            data={"client_match_id": "m_01"},
        )
        assert created.status_code == 202
        payload = created.json()
        assert payload["status"] == "queued"
        assert "source_path" not in payload
        job_id = payload["job_id"]

        result = None
        running_eta_seen = False
        for _ in range(50):
            result = client.get(f"/api/v1/detection-jobs/{job_id}").json()
            if result["status"] == "running" and result.get("eta_seconds") == 3:
                running_eta_seen = True
            if result["status"] == "succeeded":
                break
            time.sleep(0.01)
        assert result is not None and result["status"] == "succeeded"
        assert running_eta_seen
        assert result["diagnostics"]["frame_detections_by_class"] == {"player": 17}
        assert result["diagnostics"]["source_frames"] == 25
        assert result["diagnostics"]["full_video_processed"] is True
        assert result["eta_seconds"] == 0
        assert "逐帧检测次数不代表唯一球员人数" in result["warnings"]

        artifact = client.get(
            f"/api/v1/detection-jobs/{job_id}/artifacts/annotated-video"
        )
        assert artifact.status_code == 200
        assert artifact.headers["content-type"].startswith("video/mp4")


def test_rejects_unsupported_file(tmp_path):
    settings = Settings(model_path=tmp_path / "unused.pt", jobs_dir=tmp_path / "jobs")
    app = create_app(settings=settings, runner=FakeRunner())
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/detection-jobs",
            files={"video": ("notes.txt", b"hello", "text/plain")},
        )
        assert response.status_code == 415


def test_fifteen_minute_limit_is_enforced():
    assert validate_video_metadata(
        fps=30, width=1280, height=720, total_frames=30 * 900, max_duration_seconds=900
    ) == 900
    try:
        validate_video_metadata(
            fps=30,
            width=1280,
            height=720,
            total_frames=30 * 901,
            max_duration_seconds=900,
        )
    except ProcessingError as exc:
        assert exc.code == "VIDEO_TOO_LONG"
    else:
        raise AssertionError("超过15分钟的视频应被拒绝")

    validate_full_decode(processed_frames=26998, source_frames=27000)
    try:
        validate_full_decode(processed_frames=26997, source_frames=27000)
    except ProcessingError as exc:
        assert exc.code == "VIDEO_DECODE_INCOMPLETE"
    else:
        raise AssertionError("完整视频缺失超过2帧时应判定解码不完整")


def test_interrupted_job_is_persisted_as_failed(tmp_path):
    jobs_dir = tmp_path / "jobs"
    store = JobStore(jobs_dir)
    store.put(
        JobRecord(
            job_id="job_interrupted",
            status="running",
            stage="detecting",
            progress=42,
            eta_seconds=18,
            source_path=str(tmp_path / "input.mp4"),
            output_path=str(tmp_path / "annotated.mp4"),
        )
    )

    restored = JobStore(jobs_dir).get("job_interrupted")
    assert restored is not None
    assert restored.status == "failed"
    assert restored.stage == "failed"
    assert restored.eta_seconds is None
    assert restored.completed_at is not None
    assert restored.error is not None and restored.error.code == "SERVICE_RESTARTED"
