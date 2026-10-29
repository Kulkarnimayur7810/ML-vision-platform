"""Run a stored checkpoint on one uploaded image or a short video (sampled frames)."""
from __future__ import annotations

import shutil
import time

from ..agent import JobContext
from ..db import J
from .train import pick_device


def _detections(res, names):
    if res.boxes is not None and len(res.boxes):
        out = []
        for c, xy, s in zip(res.boxes.cls.tolist(), res.boxes.xyxy.tolist(), res.boxes.conf.tolist()):
            out.append({"class": names.get(int(c), str(int(c))), "classIndex": int(c), "confidence": round(float(s), 4), "box": [round(v, 1) for v in xy]})
        return out
    return []


def run(ctx: JobContext) -> dict:
    from ultralytics import YOLO

    pr = ctx.conn.execute("select * from predictions where id = %s and workspace_id = %s", (ctx.params["predictionId"], ctx.workspace_id)).fetchone()
    if not pr:
        raise RuntimeError("Prediction not found.")
    run_ = ctx.conn.execute("select * from training_runs where id = %s", (pr["run_id"],)).fetchone()
    best = (run_["artifacts"] or {}).get("best")
    if not best:
        raise RuntimeError("This run has no checkpoint.")
    device = pick_device("auto")
    work = ctx.cfg.work_dir / f"pred-{pr['id']}"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    ctx.store.get_file(best["key"], work / "best.pt")
    src = work / pr["filename"].replace("/", "_")
    ctx.store.get_file(pr["input_key"], src)
    model = YOLO(str(work / "best.pt"))
    names = {int(k): v for k, v in model.names.items()}
    imgsz = int(run_["config"]["imgsz"])
    kw = dict(conf=float(pr["conf"]), iou=float(pr["iou"]), device=device, verbose=False, imgsz=imgsz)
    task = run_["task_type"]
    frames = []
    if pr["kind"] == "image":
        t0 = time.time()
        res = model.predict(str(src), **kw)[0]
        ms = (time.time() - t0) * 1000
        h, w = res.orig_shape
        frames.append({"frame": 0, "width": w, "height": h, "latencyMs": round(ms, 1),
                       **({"detections": _detections(res, names)} if task == "detect" else
                          {"top": [{"class": names[int(i)], "confidence": round(float(res.probs.data[int(i)]), 4)} for i in res.probs.top5]})})
    else:
        import cv2
        cap = cv2.VideoCapture(str(src))
        fps = cap.get(cv2.CAP_PROP_FPS) or 25
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if total <= 0 or total / fps > 60:
            raise RuntimeError("Videos must be 60 seconds or shorter.")
        step = max(1, int(fps // 2))  # ~2 frames per second
        idx = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if idx % step == 0:
                ctx.check_cancel()
                t0 = time.time()
                res = model.predict(frame, **kw)[0]
                ms = (time.time() - t0) * 1000
                h, w = res.orig_shape
                frames.append({"frame": idx, "time": round(idx / fps, 2), "width": w, "height": h, "latencyMs": round(ms, 1),
                               **({"detections": _detections(res, names)} if task == "detect" else
                                  {"top": [{"class": names[int(i)], "confidence": round(float(res.probs.data[int(i)]), 4)} for i in res.probs.top5]})})
                ctx.progress(min(0.95, idx / max(1, total)), f"Frame {idx}/{total}")
            idx += 1
        cap.release()
    result = {"task": task, "device": device, "conf": float(pr["conf"]), "iou": float(pr["iou"]), "classes": names, "frames": frames}
    ctx.conn.execute("update predictions set result = %s where id = %s", (J(result), pr["id"]))
    shutil.rmtree(work, ignore_errors=True)
    return {"predictionId": str(pr["id"]), "frames": len(frames)}
