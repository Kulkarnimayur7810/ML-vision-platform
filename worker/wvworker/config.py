"""Worker configuration. Everything comes from environment variables (or a .env file next to where you run it)."""
from __future__ import annotations

import os
import socket
import tempfile
from dataclasses import dataclass
from pathlib import Path


def _load_dotenv() -> None:
    for name in (".env.worker", ".env"):
        p = Path(name)
        if not p.exists():
            continue
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip("'\""))


@dataclass
class Config:
    database_url: str
    storage_driver: str
    local_dir: str
    s3_bucket: str | None
    s3_endpoint: str | None
    s3_region: str
    s3_key: str | None
    s3_secret: str | None
    work_dir: Path
    name: str
    poll_seconds: float = 3.0
    heartbeat_seconds: float = 15.0
    stale_seconds: int = 120


def load() -> Config:
    _load_dotenv()
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise SystemExit("DATABASE_URL is not set. See worker/README.md.")
    if url.startswith("postgresql+psycopg://"):
        url = url.replace("postgresql+psycopg://", "postgresql://", 1)
    work = Path(os.environ.get("WORKER_DIR") or Path(tempfile.gettempdir()) / "wv-worker")
    work.mkdir(parents=True, exist_ok=True)
    return Config(
        database_url=url,
        storage_driver=os.environ.get("STORAGE_DRIVER", "local"),
        local_dir=os.environ.get("LOCAL_STORAGE_DIR", str(Path.cwd() / ".local-storage")),
        s3_bucket=os.environ.get("S3_BUCKET"),
        s3_endpoint=os.environ.get("S3_ENDPOINT") or None,
        s3_region=os.environ.get("S3_REGION", "auto"),
        s3_key=os.environ.get("S3_ACCESS_KEY_ID"),
        s3_secret=os.environ.get("S3_SECRET_ACCESS_KEY"),
        work_dir=work,
        name=os.environ.get("WORKER_NAME") or socket.gethostname(),
    )
