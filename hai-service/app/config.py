from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    model_path: Path
    jobs_dir: Path
    max_upload_bytes: int = 300 * 1024 * 1024
    max_duration_seconds: float = 15 * 60
    confidence: float = 0.25
    device: str = "0"

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            model_path=Path(
                os.getenv(
                    "HAOQIU_MODEL_PATH",
                    "/root/haoqiu-sports/examples/soccer/data/football-player-detection.pt",
                )
            ),
            jobs_dir=Path(os.getenv("HAOQIU_JOBS_DIR", "/root/haoqiu-service/jobs")),
            max_upload_bytes=int(os.getenv("HAOQIU_MAX_UPLOAD_BYTES", 300 * 1024 * 1024)),
            max_duration_seconds=float(os.getenv("HAOQIU_MAX_DURATION_SECONDS", 15 * 60)),
            confidence=float(os.getenv("HAOQIU_CONFIDENCE", "0.25")),
            device=os.getenv("HAOQIU_DEVICE", "0"),
        )

