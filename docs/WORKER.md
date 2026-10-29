# The worker

The worker is a Python program that connects **directly to your Postgres and bucket**, claims queued jobs and runs
them. Run it on any computer you trust — it holds the database credentials.

> Tested here: Linux, CPU only, Python 3.13, Ultralytics 8.4, PyTorch 2.14. **Not tested:** GPU training, Windows,
> macOS. They should work (the code is plain PyTorch/Ultralytics) but have not been verified.

## Install
```bash
cd worker
python -m venv .venv && source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```
For an NVIDIA GPU, install the matching CUDA build of PyTorch first by following pytorch.org's selector, then
`pip install -r requirements.txt`. Without a GPU, training is CPU-only: fine for the Quick test preset, slow for
real datasets.

## Configure
```bash
cp .env.worker.example .env.worker          # git-ignored; never share it
```
Set `DATABASE_URL` (direct/session string, port 5432 — the transaction pooler is not suitable for a long-lived
worker) and the `S3_*` values (or `STORAGE_DRIVER=local` + `LOCAL_STORAGE_DIR` for same-machine development).

## Run
```bash
python -m wvworker check     # verifies DB + storage, prints GPU info, registers the worker
python -m wvworker run       # polls forever; Ctrl+C to stop
python -m wvworker once      # process one job and exit
```
Keep it running while you train. Linux: a systemd service or `tmux`; Windows: a terminal left open or Task Scheduler.
The first training run with pretrained weights downloads them from the internet (Ultralytics), so the worker needs
outbound access at least once.

## How it behaves
- **Claiming:** `FOR UPDATE SKIP LOCKED`, so several workers never take the same job.
- **Heartbeat:** every 15 s. A running job silent for 120 s is marked **interrupted** (never “completed”) and its
  run/evaluation follows; the UI offers “Retry with same settings”.
- **Cancel:** queued jobs cancel instantly; running jobs stop at the next epoch/image after the next heartbeat
  (up to ~15 s).
- **Honest numbers:** per-epoch values come from Ultralytics' validator on the **validation** split. Evaluation
  runs on exactly the split you choose and stores it with the result. Nothing is estimated or filled in.
- **Disk:** work happens under `WORKER_DIR` (default: system temp `wv-worker/`); datasets are copied there per job
  and removed afterwards.
- **Job kinds:** `train`, `evaluate`, `predict`, `export_dataset`.

## Security
Anyone with `.env.worker` can read and change the whole database and bucket. Keep it on a machine you control,
don't commit it, and rotate the database password if a laptop is lost.
