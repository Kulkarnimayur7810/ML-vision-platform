"""Job loop: claims queued jobs, heartbeats while running, reports progress/logs, never fakes a status."""
from __future__ import annotations

import logging
import threading
import time
import traceback
from typing import Callable

from . import __version__
from .config import Config
from .db import J, connect
from .storage import make_store

log = logging.getLogger("wvworker")


class Cancelled(Exception):
    """Raised inside a handler when the user asked to cancel the job."""


class JobContext:
    def __init__(self, cfg: Config, store, job: dict, conn):
        self.cfg, self.store, self.job, self.conn = cfg, store, job, conn
        self.params: dict = job["params"] or {}
        self.id = job["id"]
        self.workspace_id = str(job["workspace_id"])
        self.cancel_event = threading.Event()
        self._last_progress = 0.0

    @property
    def cancelled(self) -> bool:
        return self.cancel_event.is_set()

    def check_cancel(self):
        if self.cancelled:
            raise Cancelled()

    def log(self, line: str) -> None:
        log.info("[%s] %s", str(self.id)[:8], line)
        self.conn.execute("insert into worker_job_logs (job_id, line) values (%s, %s)", (self.id, line[:2000]))

    def progress(self, value: float, message: str | None = None) -> None:
        now = time.time()
        if now - self._last_progress < 1.0 and value < 1:
            return
        self._last_progress = now
        self.conn.execute("update worker_jobs set progress = %s, message = coalesce(%s, message) where id = %s", (max(0.0, min(1.0, value)), message, self.id))


Handler = Callable[[JobContext], dict | None]


def handlers() -> dict[str, Handler]:
    from .handlers import evaluate, export, predict, train
    return {"train": train.run, "evaluate": evaluate.run, "predict": predict.run, "export_dataset": export.run}


def reconcile_stale(conn, stale_seconds: int) -> int:
    """A running job whose worker stopped heart-beating is 'interrupted', never 'completed'."""
    rows = conn.execute(
        """update worker_jobs set status = 'interrupted', finished_at = now(), error = 'The worker stopped responding (computer slept, lost network or was shut down). Retry the job.'
           where status = 'running' and heartbeat_at < now() - make_interval(secs => %s) returning id, kind""", (stale_seconds,)).fetchall()
    for r in rows:
        conn.execute("update training_runs set status = 'interrupted', finished_at = now(), error = 'The worker stopped responding.' where job_id = %s and status in ('queued','running')", (r["id"],))
        conn.execute("update evaluations set status = 'interrupted', finished_at = now() where job_id = %s and status in ('queued','running')", (r["id"],))
    return len(rows)


class Worker:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.store = make_store(cfg)
        self.conn = connect(cfg.database_url)
        self.id = f"{cfg.name}-{int(time.time())}"
        self.handlers = handlers()
        self.stop = threading.Event()

    def info(self) -> dict:
        info = {"version": __version__, "kinds": sorted(self.handlers)}
        try:
            import torch
            info["torch"] = torch.__version__
            info["cuda"] = bool(torch.cuda.is_available())
            info["gpu"] = torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
        except Exception as e:  # pragma: no cover
            info["torch_error"] = str(e)
        try:
            import ultralytics
            info["ultralytics"] = ultralytics.__version__
        except Exception as e:  # pragma: no cover
            info["ultralytics_error"] = str(e)
        return info

    def beat(self) -> None:
        self.conn.execute(
            """insert into workers (id, name, info, last_seen) values (%s, %s, %s, now())
               on conflict (id) do update set last_seen = now(), info = excluded.info""", (self.id, self.cfg.name, J(self.info())))

    def claim(self) -> dict | None:
        return self.conn.execute(
            """update worker_jobs set status = 'running', started_at = now(), heartbeat_at = now(), worker_id = %s, message = 'Starting…'
               where id = (select id from worker_jobs where status = 'queued' and kind = any(%s) order by created_at for update skip locked limit 1)
               returning *""", (self.id, list(self.handlers))).fetchone()

    def run_job(self, job: dict) -> None:
        ctx_conn = connect(self.cfg.database_url)
        ctx = JobContext(self.cfg, self.store, job, ctx_conn)
        done = threading.Event()
        if job.get("cancel_requested"):
            ctx.cancel_event.set()

        def heartbeat():
            hb = connect(self.cfg.database_url)
            try:
                while not done.wait(self.cfg.heartbeat_seconds):
                    row = hb.execute("update worker_jobs set heartbeat_at = now() where id = %s returning cancel_requested", (job["id"],)).fetchone()
                    hb.execute("update workers set last_seen = now() where id = %s", (self.id,))
                    if row and row["cancel_requested"]:
                        ctx.cancel_event.set()
            finally:
                hb.close()

        t = threading.Thread(target=heartbeat, daemon=True)
        t.start()
        ctx.log(f"Started {job['kind']} on {self.cfg.name}")
        try:
            ctx.check_cancel()
            result = self.handlers[job["kind"]](ctx) or {}
            ctx.check_cancel()
            ctx_conn.execute("update worker_jobs set status = 'completed', progress = 1, result = %s, finished_at = now(), message = 'Done' where id = %s", (J(result), job["id"]))
            ctx.log("Completed")
        except Cancelled:
            ctx_conn.execute("update worker_jobs set status = 'cancelled', finished_at = now(), message = 'Cancelled' where id = %s", (job["id"],))
            self._mirror(ctx_conn, job, "cancelled", None)
            ctx.log("Cancelled by user")
        except Exception as e:
            tb = traceback.format_exc()
            log.error("Job failed: %s", tb)
            msg = f"{type(e).__name__}: {e}"
            try:
                ctx.log("FAILED: " + msg)
                for line in tb.strip().splitlines()[-12:]:
                    ctx.log(line)
            except Exception:
                pass
            ctx_conn.execute("update worker_jobs set status = 'failed', finished_at = now(), error = %s, message = 'Failed' where id = %s", (msg[:1500], job["id"]))
            self._mirror(ctx_conn, job, "failed", msg[:1500])
        finally:
            done.set()
            t.join(timeout=5)
            ctx_conn.close()

    @staticmethod
    def _mirror(conn, job, status: str, error: str | None) -> None:
        conn.execute("update training_runs set status = %s, finished_at = now(), error = %s where job_id = %s and status in ('queued','running')", (status, error, job["id"]))
        conn.execute("update evaluations set status = %s, finished_at = now() where job_id = %s and status in ('queued','running')", (status, job["id"]))

    def run_forever(self, once: bool = False) -> None:
        log.info("Worker %s ready. Handlers: %s", self.id, ", ".join(sorted(self.handlers)))
        last_beat = 0.0
        while not self.stop.is_set():
            if time.time() - last_beat > self.cfg.heartbeat_seconds:
                self.beat(); last_beat = time.time()
                n = reconcile_stale(self.conn, self.cfg.stale_seconds)
                if n:
                    log.warning("Marked %d stalled job(s) as interrupted", n)
            job = self.claim()
            if job:
                self.run_job(job)
                if once:
                    return
                continue
            if once:
                return
            self.stop.wait(self.cfg.poll_seconds)
