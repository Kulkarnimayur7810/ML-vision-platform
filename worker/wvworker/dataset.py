"""Materialise a frozen dataset version on disk in the layout Ultralytics expects."""
from __future__ import annotations

import json
import re
from pathlib import Path

from .agent import JobContext


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_\-]+", "_", name)


def materialize(ctx: JobContext, version_id: str, root: Path, splits: tuple[str, ...] = ("train", "val", "test")) -> dict:
    conn = ctx.conn
    v = conn.execute(
        """select v.*, d.task_type, d.workspace_id from dataset_versions v join datasets d on d.id = v.dataset_id
           where v.id = %s and d.workspace_id = %s""", (version_id, ctx.workspace_id)).fetchone()
    if not v:
        raise RuntimeError("Dataset version not found in this workspace.")
    classes = sorted(v["classes"], key=lambda c: c["index"])
    names = {c["index"]: c["name"] for c in classes}
    task = v["task_type"]
    rows = conn.execute(
        """select vi.split, vi.class_index, vi.boxes, i.id, i.storage_key, i.filename
           from version_images vi join dataset_images i on i.id = vi.image_id
           where vi.version_id = %s and vi.split = any(%s) order by i.created_at, i.id""", (version_id, list(splits))).fetchall()
    counts: dict[str, int] = {}
    root.mkdir(parents=True, exist_ok=True)
    for n, r in enumerate(rows):
        ctx.check_cancel()
        ext = r["storage_key"].rsplit(".", 1)[-1]
        sp = r["split"]
        if task == "detect":
            img = root / "images" / sp / f"{r['id']}.{ext}"
            lab = root / "labels" / sp / f"{r['id']}.txt"
            lab.parent.mkdir(parents=True, exist_ok=True)
            lab.write_text("".join(f"{b['classIndex']} {b['cx']:.6f} {b['cy']:.6f} {b['w']:.6f} {b['h']:.6f}\n" for b in (r["boxes"] or [])))
        else:
            cname = _safe(names[r["class_index"]])
            img = root / sp / cname / f"{r['id']}.{ext}"
        ctx.store.get_file(r["storage_key"], img)
        counts[sp] = counts.get(sp, 0) + 1
        if n % 10 == 0:
            ctx.progress(0.02 + 0.18 * n / max(1, len(rows)), f"Preparing images {n + 1}/{len(rows)}")
    info = {"task": task, "names": names, "counts": counts, "classes": classes, "number": v["number"], "root": str(root)}
    if task == "detect":
        yaml = [f"path: {root.as_posix()}", "train: images/train", "val: images/val"]
        if counts.get("test"):
            yaml.append("test: images/test")
        yaml.append("names:")
        yaml += [f"  {i}: {json.dumps(n)}" for i, n in sorted(names.items())]
        (root / "data.yaml").write_text("\n".join(yaml) + "\n")
        info["data"] = str(root / "data.yaml")
    else:
        # Ultralytics classification reads <root>/train, <root>/val (and test) with one folder per class.
        for sp in ("train", "val"):
            (root / sp).mkdir(exist_ok=True)
        for sp in ("train", "val", "test"):
            if (root / sp).exists():
                for c in names.values():
                    (root / sp / _safe(c)).mkdir(parents=True, exist_ok=True)
        info["data"] = str(root)
    return info
