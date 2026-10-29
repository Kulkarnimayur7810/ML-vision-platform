"""Real end-to-end worker test: Postgres + local storage + a genuine (tiny, CPU) Ultralytics run.
Needs TEST_DATABASE_URL pointing at a database with the web migrations applied (npm run migrate)."""
import json, os, random, uuid
from pathlib import Path

import numpy as np
import psycopg
import pytest
from PIL import Image, ImageDraw
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

DB = os.environ.get("TEST_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/wv_worker_test")


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", DB)
    monkeypatch.setenv("LOCAL_STORAGE_DIR", str(tmp_path / "store"))
    monkeypatch.setenv("WORKER_DIR", str(tmp_path / "work"))
    monkeypatch.setenv("STORAGE_DRIVER", "local")
    conn = psycopg.connect(DB, autocommit=True, row_factory=dict_row)
    conn.execute("truncate workspaces cascade")
    from wvworker import config
    from wvworker.storage import make_store
    cfg = config.load()
    yield cfg, conn, make_store(cfg)
    conn.close()


def make_img(rng, cls, size=96):
    im = Image.fromarray(rng.integers(90, 130, (size, size, 3), dtype=np.uint8))
    d = ImageDraw.Draw(im)
    x, y, s = int(rng.integers(8, 40)), int(rng.integers(8, 40)), int(rng.integers(30, 48))
    col = (230, 20, 20) if cls == 0 else (20, 20, 230)
    (d.rectangle if cls == 0 else d.ellipse)([x, y, x + s, y + s], fill=col)
    return im, ((x + s / 2) / size, (y + s / 2) / size, s / size, s / size)


def seed(cfg, conn, store, task, tmp_path):
    rng = np.random.default_rng(1)
    ws = conn.execute("insert into workspaces (slug, name) values (%s, 'T') returning id", (f"t-{uuid.uuid4().hex[:6]}",)).fetchone()["id"]
    ds = conn.execute("insert into datasets (workspace_id, name, task_type) values (%s,'d',%s) returning id", (ws, task)).fetchone()["id"]
    classes = [{"index": 0, "name": "red box"}, {"index": 1, "name": "blue ball"}]
    for c in classes:
        conn.execute("insert into dataset_classes (dataset_id, idx, name) values (%s,%s,%s)", (ds, c["index"], c["name"]))
    ver = conn.execute("insert into dataset_versions (dataset_id, number, name, seed, ratios, classes, counts) values (%s,1,'v1',0,'{}',%s,'{}') returning id", (ds, Jsonb(classes))).fetchone()["id"]
    splits = ["train"] * 16 + ["val"] * 6 + ["test"] * 6
    for n, sp in enumerate(splits):
        cls = n % 2
        im, (cx, cy, w, h) = make_img(rng, cls)
        p = tmp_path / f"{n}.jpg"; im.save(p)
        iid = uuid.uuid4()
        key = f"w/{ws}/d/{ds}/images/aa/{iid}.jpg"
        store.put_file(key, p)
        conn.execute("insert into dataset_images (id, dataset_id, filename, storage_key, thumb_key, sha256, width, height, bytes, status) values (%s,%s,%s,%s,%s,%s,96,96,1,'approved')",
                     (iid, ds, f"{n}.jpg", key, key, uuid.uuid4().hex))
        boxes = [{"classIndex": cls, "cx": cx, "cy": cy, "w": w, "h": h}] if task == "detect" else []
        conn.execute("insert into version_images (version_id, image_id, split, class_index, boxes) values (%s,%s,%s,%s,%s)", (ver, iid, sp, cls if task == "classify" else None, Jsonb(boxes)))
    return ws, ds, ver


def queue(conn, ws, kind, params):
    return conn.execute("insert into worker_jobs (workspace_id, kind, params) values (%s,%s,%s) returning id", (ws, kind, Jsonb(params))).fetchone()["id"]


def run_once(cfg):
    from wvworker.agent import Worker
    Worker(cfg).run_forever(once=True)


@pytest.mark.parametrize("task,arch", [("detect", "yolov8n"), ("classify", "yolov8n-cls")])
def test_train_evaluate_predict_export(env, tmp_path, task, arch):
    cfg, conn, store = env
    ws, ds, ver = seed(cfg, conn, store, task, tmp_path)
    run = conn.execute("""insert into training_runs (workspace_id, number, name, dataset_id, version_id, task_type, arch, pretrained, config)
        values (%s,1,'r',%s,%s,%s,%s,false,%s) returning id""", (ws, ds, ver, task, arch, Jsonb({"epochs": 2, "imgsz": 64, "batch": 4, "lr0": 0.01, "device": "cpu", "seed": 0}))).fetchone()["id"]
    job = queue(conn, ws, "train", {"runId": str(run)})
    conn.execute("update training_runs set job_id = %s where id = %s", (job, run))
    run_once(cfg)
    j = conn.execute("select * from worker_jobs where id = %s", (job,)).fetchone()
    assert j["status"] == "completed", j["error"]
    r = conn.execute("select * from training_runs where id = %s", (run,)).fetchone()
    assert r["status"] == "completed" and r["epochs_done"] == 2
    assert r["best_metrics"]["split"] == "val"
    assert conn.execute("select count(*) n from run_epochs where run_id = %s", (run,)).fetchone()["n"] == 2
    assert (Path(cfg.local_dir) / r["artifacts"]["best"]["key"]).exists()
    ep = conn.execute("select metrics from run_epochs where run_id = %s order by epoch", (run,)).fetchall()
    assert all(v is not None for e in ep for v in e["metrics"]["train_loss"].values()) and ep[0]["metrics"]["train_loss"]

    ev = conn.execute("insert into evaluations (workspace_id, run_id, split) values (%s,%s,'test') returning id", (ws, run)).fetchone()["id"]
    queue(conn, ws, "evaluate", {"evaluationId": str(ev)})
    run_once(cfg)
    e = conn.execute("select * from evaluations where id = %s", (ev,)).fetchone()
    assert e["status"] == "completed", conn.execute("select error from worker_jobs where kind='evaluate'").fetchone()
    assert e["metrics"]["split"] == "test" and e["n_images"] == 6
    assert len(e["confusion"]["matrix"]) >= 2

    key = f"w/{ws}/uploads/x.jpg"
    im, _ = make_img(np.random.default_rng(5), 0); p = tmp_path / "up.jpg"; im.save(p); store.put_file(key, p)
    pr = conn.execute("insert into predictions (workspace_id, run_id, kind, input_key, filename, conf, iou) values (%s,%s,'image',%s,'x.jpg',0.1,0.7) returning id", (ws, run, key)).fetchone()["id"]
    queue(conn, ws, "predict", {"predictionId": str(pr)})
    run_once(cfg)
    res = conn.execute("select result from predictions where id = %s", (pr,)).fetchone()["result"]
    assert res and len(res["frames"]) == 1

    queue(conn, ws, "export_dataset", {"versionId": str(ver)})
    run_once(cfg)
    ex = conn.execute("select * from worker_jobs where kind='export_dataset'").fetchone()
    assert ex["status"] == "completed", ex["error"]
    assert (Path(cfg.local_dir) / ex["result"]["key"]).stat().st_size > 0


def test_stale_job_is_interrupted_not_completed(env):
    cfg, conn, store = env
    ws = conn.execute("insert into workspaces (slug, name) values ('stale', 'S') returning id").fetchone()["id"]
    jid = conn.execute("insert into worker_jobs (workspace_id, kind, status, heartbeat_at, started_at) values (%s,'train','running', now() - interval '10 minutes', now() - interval '11 minutes') returning id", (ws,)).fetchone()["id"]
    from wvworker.agent import reconcile_stale
    assert reconcile_stale(conn, 120) == 1
    assert conn.execute("select status from worker_jobs where id=%s", (jid,)).fetchone()["status"] == "interrupted"


def test_cancel_before_start(env):
    cfg, conn, store = env
    ws = conn.execute("insert into workspaces (slug, name) values ('c', 'S') returning id").fetchone()["id"]
    jid = conn.execute("insert into worker_jobs (workspace_id, kind, params, cancel_requested) values (%s,'export_dataset','{}',true) returning id", (ws,)).fetchone()["id"]
    run_once(cfg)
    assert conn.execute("select status from worker_jobs where id=%s", (jid,)).fetchone()["status"] in ("cancelled",)


@pytest.mark.skipif(not os.environ.get("TEST_S3_ENDPOINT"), reason="needs an S3-compatible endpoint (moto/MinIO)")
def test_s3_store_roundtrip(tmp_path, monkeypatch):
    for k, v in {"DATABASE_URL": DB, "STORAGE_DRIVER": "s3", "S3_ENDPOINT": os.environ["TEST_S3_ENDPOINT"], "S3_BUCKET": "wv-test", "S3_REGION": "us-east-1", "S3_ACCESS_KEY_ID": "test", "S3_SECRET_ACCESS_KEY": "test", "WORKER_DIR": str(tmp_path)}.items():
        monkeypatch.setenv(k, v)
    from wvworker import config
    from wvworker.storage import make_store
    st = make_store(config.load())
    src = tmp_path / "a.bin"; src.write_bytes(b"x" * 4096)
    st.put_file("w/ws/test/a.bin", src)
    dst = tmp_path / "out" / "a.bin"
    st.get_file("w/ws/test/a.bin", dst)
    assert dst.read_bytes() == src.read_bytes()
    with pytest.raises(Exception):
        st.get_file("w/ws/test/missing.bin", tmp_path / "m.bin")
