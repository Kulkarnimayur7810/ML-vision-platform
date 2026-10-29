"""Evaluate a trained checkpoint on ONE named split. Results are always labelled with that split."""
from __future__ import annotations

import shutil
from pathlib import Path

from ..agent import JobContext
from ..db import J
from ..dataset import materialize, _safe
from .train import pick_device, _num

IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def _iou(a, b):
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    iw, ih = max(0, min(ax2, bx2) - max(ax1, bx1)), max(0, min(ay2, by2) - max(ay1, by1))
    inter = iw * ih
    u = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
    return inter / u if u > 0 else 0.0


def run(ctx: JobContext) -> dict:
    from ultralytics import YOLO

    ev = ctx.conn.execute("select * from evaluations where id = %s and workspace_id = %s", (ctx.params["evaluationId"], ctx.workspace_id)).fetchone()
    if not ev:
        raise RuntimeError("Evaluation not found.")
    run_ = ctx.conn.execute("select * from training_runs where id = %s", (ev["run_id"],)).fetchone()
    split = ev["split"]
    best = (run_["artifacts"] or {}).get("best")
    if not best:
        raise RuntimeError("This run has no checkpoint to evaluate.")
    ctx.conn.execute("update evaluations set status = 'running' where id = %s", (ev["id"],))
    device = pick_device("auto")
    work = ctx.cfg.work_dir / f"eval-{ev['id']}"
    shutil.rmtree(work, ignore_errors=True)
    ckpt = work / "best.pt"
    ctx.store.get_file(best["key"], ckpt)
    info = materialize(ctx, run_["version_id"], work / "data", (split,))
    n = info["counts"].get(split, 0)
    if n == 0:
        raise RuntimeError(f"The dataset version has no images in the '{split}' split.")
    ctx.log(f"Evaluating on the {split.upper()} split: {n} images (dataset v{info['number']})")
    model = YOLO(str(ckpt))
    names = info["names"]
    task = info["task"]
    ctx.progress(0.3, "Evaluating")

    if task == "detect":
        # Ultralytics validates against whichever split key the yaml points to.
        yaml = Path(info["data"])
        txt = yaml.read_text() + (f"val: images/{split}\n" if split != "val" else "")
        # Rewrite so `val` points at the requested split (only that split exists on disk).
        lines = [l for l in txt.splitlines() if not l.startswith(("train:", "val:", "test:"))]
        lines.insert(1, f"val: images/{split}")
        lines.insert(1, f"train: images/{split}")
        yaml.write_text("\n".join(lines) + "\n")
        r = model.val(data=str(yaml), imgsz=int(run_["config"]["imgsz"]), batch=8, device=device, plots=False, verbose=False, workers=0, project=str(work / "v"), name="val", exist_ok=True)
        b = r.box
        per_class = []
        for i, ci in enumerate(b.ap_class_index.tolist()):
            per_class.append({"class": names.get(int(ci), str(ci)), "precision": _num(b.p[i]), "recall": _num(b.r[i]), "ap50": _num(b.ap50[i]), "ap5095": _num(b.ap[i])})
        metrics = {"precision": _num(b.mp), "recall": _num(b.mr), "map50": _num(b.map50), "map5095": _num(b.map)}
        cm = r.confusion_matrix.matrix.tolist()
        labels = [names[i] for i in sorted(names)] + ["background"]
        confusion = {"labels": labels, "matrix": cm}
        # Error analysis at a fixed confidence so users can see which images fail.
        errors = []
        imgs = sorted((work / "data" / "images" / split).iterdir())
        for k, ip in enumerate(imgs):
            ctx.check_cancel()
            ctx.progress(0.6 + 0.35 * k / len(imgs), f"Error analysis {k + 1}/{len(imgs)}")
            res = model.predict(str(ip), conf=0.25, iou=0.7, device=device, verbose=False, imgsz=int(run_["config"]["imgsz"]))[0]
            h, w = res.orig_shape
            gt = []
            lp = work / "data" / "labels" / split / f"{ip.stem}.txt"
            for line in (lp.read_text().splitlines() if lp.exists() else []):
                c, cx, cy, bw, bh = line.split()
                cx, cy, bw, bh = float(cx) * w, float(cy) * h, float(bw) * w, float(bh) * h
                gt.append((int(c), (cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2)))
            pr = [(int(c), tuple(xy), float(s)) for c, xy, s in zip(res.boxes.cls.tolist(), res.boxes.xyxy.tolist(), res.boxes.conf.tolist())]
            used, tp = set(), 0
            for c, box, _s in sorted(pr, key=lambda x: -x[2]):
                hit = next((j for j, (gc, gb) in enumerate(gt) if j not in used and gc == c and _iou(box, gb) >= 0.5), None)
                if hit is not None:
                    used.add(hit); tp += 1
            fp, fn = len(pr) - tp, len(gt) - tp
            if fp or fn:
                errors.append({"imageId": ip.stem, "fp": fp, "fn": fn})
        errors.sort(key=lambda e: -(e["fp"] + e["fn"]))
        speed = {k: _num(v) for k, v in (r.speed or {}).items()}
        extra = {"errorAnalysis": {"confidence": 0.25, "iou": 0.5, "images": errors[:100], "imagesWithErrors": len(errors)}}
    else:
        root = work / "data" / split
        order = {_safe(names[i]): i for i in names}
        k_total = len(names)
        cm = [[0] * k_total for _ in range(k_total)]
        top1 = top5 = tot = 0
        wrong = []
        files = [(p, order[p.parent.name]) for p in sorted(root.rglob("*")) if p.suffix.lower() in IMG_EXT]
        import time
        t0 = time.time()
        for k, (p, truth) in enumerate(files):
            ctx.check_cancel()
            ctx.progress(0.3 + 0.65 * k / len(files), f"Predicting {k + 1}/{len(files)}")
            res = model.predict(str(p), device=device, verbose=False, imgsz=int(run_["config"]["imgsz"]))[0]
            mn = {int(i): n for i, n in model.names.items()}
            by_name = {n: i for i, n in mn.items()}
            def to_ds(model_idx):
                return order[_safe(mn[model_idx])] if _safe(mn[model_idx]) in order else None
            pred = to_ds(int(res.probs.top1))
            t5 = [to_ds(int(i)) for i in res.probs.top5]
            tot += 1
            top1 += pred == truth
            top5 += truth in t5
            if pred is not None:
                cm[truth][pred] += 1
            if pred != truth:
                wrong.append({"imageId": p.stem, "truth": names[truth], "predicted": names.get(pred)})
        per_class = []
        for i in sorted(names):
            tp = cm[i][i]; fn = sum(cm[i]) - tp; fp = sum(cm[j][i] for j in range(k_total)) - tp
            pr_ = tp / (tp + fp) if tp + fp else None
            rc = tp / (tp + fn) if tp + fn else None
            f1 = 2 * pr_ * rc / (pr_ + rc) if pr_ and rc else (0.0 if pr_ is not None and rc is not None else None)
            per_class.append({"class": names[i], "support": tp + fn, "precision": _num(pr_) if pr_ is not None else None, "recall": _num(rc) if rc is not None else None, "f1": _num(f1) if f1 is not None else None})
        metrics = {"top1": _num(top1 / tot), "top5": _num(top5 / tot) if k_total >= 5 else None}
        confusion = {"labels": [names[i] for i in sorted(names)], "matrix": cm}
        speed = {"per_image_ms": round((time.time() - t0) * 1000 / max(1, tot), 2)}
        extra = {"misclassified": wrong[:100]}

    metrics["split"] = split
    ctx.conn.execute(
        "update evaluations set status='completed', metrics=%s, per_class=%s, confusion=%s, speed=%s, n_images=%s, finished_at=now() where id=%s",
        (J({**metrics, **extra}), J(per_class), J(confusion), J({**speed, "device": device}), n, ev["id"]))
    shutil.rmtree(work, ignore_errors=True)
    return {"evaluationId": str(ev["id"]), "split": split, "n": n}
