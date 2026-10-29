from __future__ import annotations

import argparse
import logging
import os
import sys

# Keep Ultralytics offline-friendly and quiet. Must be set before it is imported.
os.environ.setdefault("YOLO_AUTOINSTALL", "False")
os.environ.setdefault("YOLO_VERBOSE", "False")


def main() -> int:
    ap = argparse.ArgumentParser(prog="wvworker", description="WasteVision worker")
    ap.add_argument("command", choices=["run", "once", "check"], help="run: poll forever · once: process one job and exit · check: verify setup")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    from .config import load
    cfg = load()
    from .agent import Worker
    w = Worker(cfg)
    if args.command == "check":
        row = w.conn.execute("select count(*)::int as n from worker_jobs").fetchone()
        info = w.info()
        print(f"Database OK ({row['n']} jobs on record). Storage: {cfg.storage_driver}.")
        print(f"Worker info: {info}")
        if not info.get("cuda"):
            print("No GPU detected: training will run on the CPU (fine for tiny datasets, very slow otherwise).")
        w.beat()
        return 0
    try:
        w.run_forever(once=args.command == "once")
    except KeyboardInterrupt:
        print("Stopping…")
    return 0


if __name__ == "__main__":
    sys.exit(main())
