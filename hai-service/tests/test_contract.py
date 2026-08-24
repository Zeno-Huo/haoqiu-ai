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
from app.runner import ProcessingResult


class FakeRunner:
    gpu_available = False
    model_loaded = True

    def process(self, source: Path, output: Path, progress):
        progress("detecting", 50)
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
        for _ in range(50):
            result = client.get(f"/api/v1/detection-jobs/{job_id}").json()
            if result["status"] == "succeeded":
                break
            time.sleep(0.01)
        assert result is not None and result["status"] == "succeeded"
        assert result["diagnostics"]["frame_detections_by_class"] == {"player": 17}
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
