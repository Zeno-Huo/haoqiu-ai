from __future__ import annotations

import asyncio
from pathlib import Path

from .models import Artifacts, ErrorDetail, JobRecord, utc_now
from .runner import ProcessingError, Runner
from .store import JobStore


WARNINGS = [
    "检测结果可能包含漏检和类别误判",
    "逐帧检测次数不代表唯一球员人数",
    "检测视频逐帧处理完整源视频，暂不保留原视频音轨",
]


class DetectionService:
    def __init__(self, store: JobStore, runner: Runner):
        self.store = store
        self.runner = runner
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self._worker_task: asyncio.Task | None = None

    async def start(self) -> None:
        if self._worker_task is None:
            self._worker_task = asyncio.create_task(self._worker(), name="single-gpu-worker")

    async def stop(self) -> None:
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
            self._worker_task = None

    async def enqueue(self, record: JobRecord) -> None:
        self.store.put(record)
        await self.queue.put(record.job_id)

    async def _worker(self) -> None:
        while True:
            job_id = await self.queue.get()
            try:
                try:
                    await self._process(job_id)
                except Exception:
                    # Keep the only worker alive even if persistence or another
                    # unexpected service-layer operation fails for one job.
                    try:
                        self.store.update(
                            job_id,
                            status="failed",
                            stage="failed",
                            error=ErrorDetail(
                                code="INTERNAL_ERROR", message="检测服务发生未知错误"
                            ),
                            eta_seconds=None,
                            completed_at=utc_now(),
                        )
                    except Exception:
                        pass
            finally:
                self.queue.task_done()

    async def _process(self, job_id: str) -> None:
        record = self.store.get(job_id)
        if not record:
            return
        self.store.update(
            job_id,
            status="running",
            stage="probing",
            progress=1,
            started_at=utc_now(),
        )

        def report(stage: str, progress: int, eta_seconds: int | None) -> None:
            # JobStore is protected by a thread lock, so the inference thread can
            # persist progress directly without racing the final success update.
            self.store.update(
                job_id, stage=stage, progress=progress, eta_seconds=eta_seconds
            )

        try:
            result = await asyncio.to_thread(
                self.runner.process,
                Path(record.source_path),
                Path(record.output_path),
                report,
            )
        except ProcessingError as exc:
            Path(record.output_path).unlink(missing_ok=True)
            self.store.update(
                job_id,
                status="failed",
                stage="failed",
                error=ErrorDetail(code=exc.code, message=exc.message),
                eta_seconds=None,
                completed_at=utc_now(),
            )
        except Exception:
            Path(record.output_path).unlink(missing_ok=True)
            self.store.update(
                job_id,
                status="failed",
                stage="failed",
                error=ErrorDetail(code="INTERNAL_ERROR", message="检测服务发生未知错误"),
                eta_seconds=None,
                completed_at=utc_now(),
            )
        else:
            self.store.update(
                job_id,
                status="succeeded",
                stage="completed",
                progress=100,
                eta_seconds=0,
                model=result.model,
                input=result.input_info,
                diagnostics=result.diagnostics,
                warnings=WARNINGS,
                artifacts=Artifacts(
                    annotated_video_url=f"/api/v1/detection-jobs/{job_id}/artifacts/annotated-video"
                ),
                completed_at=utc_now(),
            )
