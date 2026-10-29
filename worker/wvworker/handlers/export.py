"""Export a frozen dataset version as a zip (YOLO layout for detection, class folders for classification)."""
from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path

from ..agent import JobContext
from ..dataset import materialize
from ..storage import sha256_file


def run(ctx: JobContext) -> dict:
    version_id = ctx.params["versionId"]
    work = ctx.cfg.work_dir / f"export-{ctx.id}"
    import shutil
    shutil.rmtree(work, ignore_errors=True)
    info = materialize(ctx, version_id, work / "data")
    if info["task"] == "detect":
        (work / "data" / "classes.txt").write_text("\n".join(info["names"][i] for i in sorted(info["names"])) + "\n")
    files = sorted(p for p in (work / "data").rglob("*") if p.is_file())
    manifest = {"version": info["number"], "task": info["task"], "classes": info["classes"], "counts": info["counts"],
                "files": {str(p.relative_to(work / "data")): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}}
    (work / "data" / "manifest.json").write_text(json.dumps(manifest, indent=1))
    out = work / "export.zip"
    ctx.progress(0.8, "Zipping")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:
        for p in sorted((work / "data").rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(work / "data").as_posix())
    key = f"w/{ctx.workspace_id}/exports/{ctx.id}.zip"
    ctx.store.put_file(key, out, "application/zip")
    res = {"key": key, "bytes": out.stat().st_size, "sha256": sha256_file(out), "counts": info["counts"], "task": info["task"], "version": info["number"]}
    shutil.rmtree(work, ignore_errors=True)
    return res
