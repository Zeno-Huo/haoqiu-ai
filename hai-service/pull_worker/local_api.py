from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx

from .models import LocalJobSnapshot


class LocalApiError(RuntimeError):
    pass


class HttpLocalDetectionApi:
    """Client for the HAI-local FastAPI service; it never exposes the service publicly."""

    def __init__(self, base_url: str = "http://127.0.0.1:8000", timeout_seconds: float = 60):
        self.base_url = base_url.rstrip("/")
        self.timeout = httpx.Timeout(timeout_seconds, connect=10)

    def create_job(self, video: Path, client_match_id: str | None) -> str:
        with video.open("rb") as source:
            response = httpx.post(
                f"{self.base_url}/api/v1/detection-jobs",
                files={"video": (video.name, source, "video/mp4")},
                data={"client_match_id": client_match_id or ""},
                timeout=self.timeout,
            )
        self._raise(response)
        return str(response.json()["job_id"])

    def get_job(self, job_id: str) -> LocalJobSnapshot:
        response = httpx.get(
            f"{self.base_url}/api/v1/detection-jobs/{job_id}", timeout=self.timeout
        )
        self._raise(response)
        payload: dict[str, Any] = response.json()
        return LocalJobSnapshot(
            job_id=payload["job_id"],
            status=payload["status"],
            progress=int(payload.get("progress", 0)),
            stage=payload.get("stage"),
            eta_seconds=payload.get("eta_seconds"),
            warnings=list(payload.get("warnings", [])),
            artifacts=dict(payload.get("artifacts", {})),
            diagnostics=payload.get("diagnostics"),
            error=payload.get("error"),
        )

    def download_artifact(self, job_id: str, destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".part")
        with httpx.stream(
            "GET",
            f"{self.base_url}/api/v1/detection-jobs/{job_id}/artifacts/annotated-video",
            timeout=self.timeout,
        ) as response:
            self._raise(response)
            with temporary.open("wb") as target:
                for chunk in response.iter_bytes():
                    target.write(chunk)
        temporary.replace(destination)

    @staticmethod
    def _raise(response: httpx.Response) -> None:
        if response.is_success:
            return
        try:
            payload = response.json()
            detail = payload.get("detail") or payload.get("error", {}).get("message")
        except Exception:
            detail = None
        raise LocalApiError(detail or f"本机检测服务返回HTTP {response.status_code}")

