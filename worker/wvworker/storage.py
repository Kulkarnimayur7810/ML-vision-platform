"""Object storage. Same key layout as the web app (web/lib/storage)."""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

from .config import Config

_KEY = re.compile(r"^[A-Za-z0-9/_.\-]+$")


def check_key(key: str) -> str:
    if not _KEY.match(key) or ".." in key or key.startswith("/"):
        raise ValueError(f"Invalid storage key: {key!r}")
    return key


class LocalStore:
    def __init__(self, root: str):
        self.root = Path(root)

    def put_file(self, key: str, path: Path, content_type: str = "application/octet-stream") -> None:
        dest = self.root / check_key(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(Path(path).read_bytes())

    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        dest = self.root / check_key(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)

    def get_file(self, key: str, path: Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_bytes((self.root / check_key(key)).read_bytes())


class S3Store:
    def __init__(self, cfg: Config):
        import boto3  # imported lazily so local-only setups don't need it configured

        if not (cfg.s3_bucket and cfg.s3_key and cfg.s3_secret):
            raise SystemExit("S3 storage selected but S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are missing.")
        self.bucket = cfg.s3_bucket
        self.c = boto3.client("s3", region_name=cfg.s3_region, endpoint_url=cfg.s3_endpoint,
                              aws_access_key_id=cfg.s3_key, aws_secret_access_key=cfg.s3_secret)

    def put_file(self, key: str, path: Path, content_type: str = "application/octet-stream") -> None:
        self.c.upload_file(str(path), self.bucket, check_key(key), ExtraArgs={"ContentType": content_type})

    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        self.c.put_object(Bucket=self.bucket, Key=check_key(key), Body=data, ContentType=content_type)

    def get_file(self, key: str, path: Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.c.download_file(self.bucket, check_key(key), str(path))


def make_store(cfg: Config):
    if cfg.storage_driver == "s3":
        return S3Store(cfg)
    if cfg.storage_driver == "local":
        return LocalStore(cfg.local_dir)
    raise SystemExit(f"Unknown STORAGE_DRIVER {cfg.storage_driver!r}")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()
