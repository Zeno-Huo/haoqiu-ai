from __future__ import annotations

import re
import shutil
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from .config import Settings
from .models import JobRecord, PUBLIC_JOB_EXCLUDES
from .runner import Runner, YoloVideoRunner
from .service import DetectionService
from .store import JobStore


ALLOWED_SUFFIXES = {".mp4", ".mov"}
SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def public_job(record: JobRecord) -> dict:
    return record.model_dump(exclude=PUBLIC_JOB_EXCLUDES, exclude_none=True)


def create_app(settings: Settings | None = None, runner: Runner | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    store = JobStore(settings.jobs_dir)
    runner = runner or YoloVideoRunner(settings)
    service = DetectionService(store, runner)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        await service.start()
        try:
            yield
        finally:
            await service.stop()

    app = FastAPI(title="好球Ai HAI Detection Service", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.store = store
    app.state.service = service

    @app.get("/health")
    async def health() -> dict:
        active, queued = store.counts()
        return {
            "status": "ok",
            "gpu_available": runner.gpu_available,
            "model_loaded": runner.model_loaded,
            "active_jobs": active,
            "queued_jobs": queued,
        }

    @app.post("/api/v1/detection-jobs", status_code=202)
    async def create_detection_job(
        video: UploadFile = File(...), client_match_id: str | None = Form(default=None)
    ) -> JSONResponse:
        original_name = Path(video.filename or "video.mp4").name
        suffix = Path(original_name).suffix.lower()
        if suffix not in ALLOWED_SUFFIXES:
            raise HTTPException(status_code=415, detail="仅支持MP4或MOV视频")

        job_id = f"job_{uuid.uuid4().hex}"
        job_dir = settings.jobs_dir / job_id
        job_dir.mkdir(parents=True, exist_ok=False)
        safe_name = SAFE_FILENAME_RE.sub("_", original_name) or f"input{suffix}"
        source_path = job_dir / safe_name
        output_path = job_dir / "annotated.mp4"
        total = 0
        try:
            with source_path.open("wb") as target:
                while chunk := await video.read(1024 * 1024):
                    total += len(chunk)
                    if total > settings.max_upload_bytes:
                        raise HTTPException(status_code=413, detail="视频不能超过300MB")
                    target.write(chunk)
        except Exception:
            shutil.rmtree(job_dir, ignore_errors=True)
            raise
        finally:
            await video.close()
        if total == 0:
            shutil.rmtree(job_dir, ignore_errors=True)
            raise HTTPException(status_code=400, detail="视频文件为空")

        record = JobRecord(
            job_id=job_id,
            client_match_id=client_match_id,
            source_path=str(source_path),
            output_path=str(output_path),
        )
        await service.enqueue(record)
        return JSONResponse(status_code=202, content=public_job(record))

    @app.get("/api/v1/detection-jobs/{job_id}")
    async def get_detection_job(job_id: str) -> dict:
        record = store.get(job_id)
        if not record:
            raise HTTPException(status_code=404, detail="检测任务不存在")
        return public_job(record)

    @app.get("/api/v1/detection-jobs/{job_id}/artifacts/annotated-video")
    async def get_annotated_video(job_id: str):
        record = store.get(job_id)
        if not record:
            raise HTTPException(status_code=404, detail="检测任务不存在")
        if record.status != "succeeded":
            raise HTTPException(status_code=409, detail="检测视频尚未生成")
        output = Path(record.output_path)
        if not output.is_file():
            raise HTTPException(status_code=404, detail="检测视频文件不存在")
        return FileResponse(
            output,
            media_type="video/mp4",
            filename=f"{job_id}-annotated.mp4",
        )

    return app


app = create_app()

