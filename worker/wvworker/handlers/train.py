"""Real YOLO training. Every epoch's numbers come from Ultralytics' validator on the VALIDATION split."""
from __future__ import annotations

import json
import shutil
import time
from pathlib import Path

from ..agent import Cancelled, JobContext
from ..db import J
from ..dataset import materialize
from ..storage import sha256_file

ALLOWED_DETECT = {"yolov8n", "yolov8s", "yolo11n", "yolo11s"}
ALLOWED_CLASSIFY = {"yolov8n-cls", "yolov8s-cls", "yolo11n-cls", "yolo11s-cls"}


def pick_device(requested: str) -> str:
    import torch
    if requested in ("", "auto"):
        return "cuda:0" if torch.cuda.is_available() else "cpu"
    if requested.startswith("cuda") and not torch.cuda.is_available():
        raise RuntimeError("A GPU was requested but this worker has none. Choose 'auto' or 'cpu'.")
    return requested


def _num(x):
    try:
        f = float(x)
        return None if f != f else round(f, 6)  # NaN → None
    except Exception:
        return None


def run(ctx: JobContext) -> dict:
    p = ctx.params
    run_id = p["runId"]
    row = ctx.conn.execute("select * from training_runs where id = %s and workspace_id = %s", (run_id, ctx.workspace_id)).fetchone()
    if not row:
        raise RuntimeError("Training run not found.")
    cfg = row["config"]
    task = row["task_type"]
    arch = row["arch"]
    if arch not in (ALLOWED_DETECT if task == "detect" else ALLOWED_CLASSIFY):
        raise RuntimeError(f"Model '{arch}' isn't allowed for {task}.")

    # Imported late so `wvworker check` works even before PyTorch is installed.
    from ultralytics import YOLO

    device = pick_device(cfg.get("device", "auto"))
    ctx.conn.execute("update training_runs set status = 'running', started_at = now(), device = %s, error = null where id = %s", (device, run_id))
    ctx.log(f"Device: {device}")

    work = ctx.cfg.work_dir / f"run-{run_id}"
    shutil.rmtree(work, ignore_errors=True)
    info = materialize(ctx, row["version_id"], work / "data", ("train", "val", "test"))
    n_train, n_val = info["counts"].get("train", 0), info["counts"].get("val", 0)
    ctx.log(f"Dataset v{info['number']}: train {n_train}, val {n_val}, test {info['counts'].get('test', 0)}")
    if n_train == 0 or n_val == 0:
        raise RuntimeError("The dataset version needs images in both the train and validation splits.")
    ctx.progress(0.2, "Loading model")

    weights = f"{arch}.pt" if row["pretrained"] else f"{arch}.yaml"
    ctx.log(f"Model: {weights} ({'pretrained on COCO/ImageNet' if row['pretrained'] else 'random initialisation'})")
    model = YOLO(weights)
    epochs = int(cfg["epochs"])
    state = {"cancelled": False, "last_epoch": 0}

    def on_epoch_end(trainer):
        ep = int(trainer.epoch) + 1
        if ep > epochs:  # Ultralytics fires this hook once more after the final best.pt validation; it is not a new epoch.
            return
        m = {k: _num(v) for k, v in (trainer.metrics or {}).items()}
        try:
            # label_loss_items maps the running training loss onto its names for both detection and classification.
            losses = {k.replace("train/", ""): _num(v) for k, v in trainer.label_loss_items(trainer.tloss, prefix="train").items()}
        except Exception:
            losses = {}
        ctx.conn.execute("insert into run_epochs (run_id, epoch, metrics) values (%s, %s, %s) on conflict (run_id, epoch) do update set metrics = excluded.metrics, at = now()",
                         (run_id, ep, J({"val": m, "train_loss": losses, "lr": _num(trainer.optimizer.param_groups[0]["lr"])})))
        ctx.conn.execute("update training_runs set epochs_done = %s where id = %s", (ep, run_id))
        state["last_epoch"] = ep
        ctx.progress(0.2 + 0.7 * ep / epochs, f"Epoch {ep}/{epochs}")
        key = "metrics/mAP50(B)" if task == "detect" else "metrics/accuracy_top1"
        ctx.log(f"epoch {ep}/{epochs} val {key.split('/')[-1]}={m.get(key)}")
        if ctx.cancelled:
            state["cancelled"] = True
            trainer.stop = True

    model.add_callback("on_fit_epoch_end", on_epoch_end)
    t0 = time.time()
    kwargs = dict(data=info["data"], epochs=epochs, imgsz=int(cfg["imgsz"]), batch=int(cfg["batch"]), lr0=float(cfg["lr0"]), device=device,
                  project=str(work / "runs"), name="train", exist_ok=True, workers=0, plots=False, verbose=False, seed=int(cfg.get("seed", 0)),
                  patience=int(cfg.get("patience", 50)), amp=device != "cpu", pretrained=bool(row["pretrained"]), val=True)
    try:
        model.train(**kwargs)
    except Exception:
        if state["cancelled"]:
            raise Cancelled()
        raise
    if state["cancelled"] or ctx.cancelled:
        raise Cancelled()
    ctx.log(f"Training finished in {time.time() - t0:.0f}s")

    save_dir = Path(model.trainer.save_dir)
    best, last = save_dir / "weights" / "best.pt", save_dir / "weights" / "last.pt"
    if not best.exists():
        raise RuntimeError("Training ended without a checkpoint (best.pt). Check the log above.")
    arts = {}
    for name, f in (("best", best), ("last", last)):
        if f.exists():
            key = f"w/{ctx.workspace_id}/runs/{run_id}/{name}.pt"
            ctx.store.put_file(key, f)
            arts[name] = {"key": key, "bytes": f.stat().st_size, "sha256": sha256_file(f)}
            ctx.log(f"Saved checkpoint {name}.pt ({f.stat().st_size / 1e6:.1f} MB)")

    # Best epoch by the validation fitness Ultralytics used to pick best.pt.
    epochs_rows = ctx.conn.execute("select epoch, metrics from run_epochs where run_id = %s order by epoch", (run_id,)).fetchall()
    key = "metrics/mAP50(B)" if task == "detect" else "metrics/accuracy_top1"
    scored = [(r["metrics"]["val"].get(key) or 0, r) for r in epochs_rows]
    bestrow = max(scored, key=lambda x: x[0])[1] if scored else None
    best_metrics = {"split": "val", "epoch": bestrow["epoch"], **bestrow["metrics"]["val"]} if bestrow else None
    names = {int(k): v for k, v in (model.names or {}).items()}
    ctx.conn.execute(
        "update training_runs set status = 'completed', finished_at = now(), best_metrics = %s, artifacts = %s, config = config || %s where id = %s",
        (J(best_metrics), J(arts), J({"class_names": names, "train_seconds": round(time.time() - t0)}), run_id))
    shutil.rmtree(work, ignore_errors=True)  # checkpoints are already uploaded
    return {"runId": run_id, "best": arts.get("best"), "epochs": state["last_epoch"]}
