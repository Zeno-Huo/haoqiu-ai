from __future__ import annotations

import os
import socket
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping
from urllib.parse import urlparse


EXPECTED_CLOUDBASE_ENV = "haoqiu-ai-prod-d3g2cm2xn3255c273"
EXPECTED_COS_BUCKET = "haoqiu-ai-media-1352817304"
EXPECTED_COS_REGION = "ap-shanghai"


class CloudConfigError(ValueError):
    pass


@dataclass(frozen=True)
class CloudWorkerConfig:
    cloudbase_env_id: str
    task_api_base: str
    task_api_token: str = field(repr=False)
    cos_bucket: str = EXPECTED_COS_BUCKET
    cos_region: str = EXPECTED_COS_REGION
    cos_secret_id: str = field(default="", repr=False)
    cos_secret_key: str = field(default="", repr=False)
    cos_session_token: str = field(default="", repr=False)
    cos_input_prefix: str = "inputs/"
    cos_output_prefix: str = "outputs/"
    local_api_base: str = "http://127.0.0.1:8000"
    worker_id: str = ""
    work_dir: Path = Path("/root/haoqiu-worker/worker-work")
    lease_seconds: int = 120
    heartbeat_interval_seconds: float = 30
    poll_interval_seconds: float = 2
    idle_interval_seconds: float = 5

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> "CloudWorkerConfig":
        env = os.environ if environ is None else environ
        config = cls(
            cloudbase_env_id=env.get("HAOQIU_CLOUDBASE_ENV_ID", EXPECTED_CLOUDBASE_ENV).strip(),
            task_api_base=env.get("HAOQIU_TASK_API_BASE", "").strip().rstrip("/"),
            task_api_token=env.get("HAOQIU_TASK_API_TOKEN", "").strip(),
            cos_bucket=env.get("HAOQIU_COS_BUCKET", EXPECTED_COS_BUCKET).strip(),
            cos_region=env.get("HAOQIU_COS_REGION", EXPECTED_COS_REGION).strip(),
            cos_secret_id=env.get("HAOQIU_COS_SECRET_ID", "").strip(),
            cos_secret_key=env.get("HAOQIU_COS_SECRET_KEY", "").strip(),
            cos_session_token=env.get("HAOQIU_COS_SESSION_TOKEN", "").strip(),
            cos_input_prefix=env.get("HAOQIU_COS_INPUT_PREFIX", "inputs/").strip(),
            cos_output_prefix=env.get("HAOQIU_COS_OUTPUT_PREFIX", "outputs/").strip(),
            local_api_base=env.get(
                "HAOQIU_LOCAL_API_BASE", "http://127.0.0.1:8000"
            ).strip().rstrip("/"),
            worker_id=env.get(
                "HAOQIU_WORKER_ID", f"hai-{socket.gethostname()}"
            ).strip(),
            work_dir=Path(
                env.get("HAOQIU_WORK_DIR", "/root/haoqiu-worker/worker-work")
            ),
            lease_seconds=int(env.get("HAOQIU_LEASE_SECONDS", "120")),
            heartbeat_interval_seconds=float(
                env.get("HAOQIU_HEARTBEAT_INTERVAL_SECONDS", "30")
            ),
            poll_interval_seconds=float(env.get("HAOQIU_POLL_INTERVAL_SECONDS", "2")),
            idle_interval_seconds=float(env.get("HAOQIU_IDLE_INTERVAL_SECONDS", "5")),
        )
        config.validate()
        return config

    def validate(self) -> None:
        if self.cloudbase_env_id != EXPECTED_CLOUDBASE_ENV:
            raise CloudConfigError("CloudBase环境ID与好球Ai生产环境不一致")
        if self.cos_bucket != EXPECTED_COS_BUCKET:
            raise CloudConfigError("COS bucket与好球Ai媒体桶不一致")
        if self.cos_region != EXPECTED_COS_REGION:
            raise CloudConfigError("COS region必须为ap-shanghai")

        parsed = urlparse(self.task_api_base)
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
            raise CloudConfigError("任务API必须使用不含用户信息的HTTPS地址")
        if parsed.query or parsed.fragment:
            raise CloudConfigError("任务API基础地址不能包含query或fragment")
        if not self.task_api_token:
            raise CloudConfigError("缺少短期或受限的任务API凭据")

        local = urlparse(self.local_api_base)
        if local.scheme != "http" or local.hostname not in {"127.0.0.1", "localhost"}:
            raise CloudConfigError("本机检测API只能使用127.0.0.1或localhost")
        if not all((self.cos_secret_id, self.cos_secret_key, self.cos_session_token)):
            raise CloudConfigError("COS必须注入SecretId/SecretKey/SessionToken三项临时凭据")
        if not self.cos_input_prefix.endswith("/") or not self.cos_output_prefix.endswith("/"):
            raise CloudConfigError("COS输入与输出前缀必须以/结尾")
        if not self.worker_id:
            raise CloudConfigError("worker_id不能为空")
        if self.lease_seconds < 30:
            raise CloudConfigError("任务租约不能短于30秒")
        if not 0 < self.heartbeat_interval_seconds < self.lease_seconds:
            raise CloudConfigError("续租间隔必须大于0且小于租约时长")
        if self.poll_interval_seconds <= 0 or self.idle_interval_seconds <= 0:
            raise CloudConfigError("轮询间隔必须大于0")
