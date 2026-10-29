# WasteVision AI — team platform

A private, login-only web platform for a small team building a computer-vision waste sorter:
dataset management, image annotation, YOLO training, evaluation, model registry, documentation and a shared Kanban board.

```
web/      Next.js app (UI + API). Deploys to Vercel.
worker/   Python worker. Runs training, evaluation, prediction and exports on a machine you control.
docs/     Guides (start here ↓)
```

| Guide | For |
|---|---|
| [docs/LOCAL_DEV.md](docs/LOCAL_DEV.md) | Run everything on your own computer |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Put the website on Vercel + Supabase + object storage |
| [docs/WORKER.md](docs/WORKER.md) | Set up the machine that trains models |
| [docs/SECURITY.md](docs/SECURITY.md) | How access is controlled, and what is verified |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common problems |
| [docs/MIGRATION_FROM_STREAMLIT.md](docs/MIGRATION_FROM_STREAMLIT.md) | Relationship to the earlier Streamlit tool |

## How it fits together

```
 browser ──► Vercel (Next.js: pages + API) ──► Postgres  ◄── worker (Python, your PC/GPU box)
                         │                                        │
                         └────────────► object storage ◄──────────┘   (images, checkpoints, exports)
```

The website never trains models. It queues jobs in Postgres; a worker claims them, reports progress and
heartbeats, and stores results. With no worker running, jobs wait and the UI says so.

## What is in the app

Private login (email + password only; no public sign-up, no email verification) · five server-enforced roles ·
team Kanban with real multi-assignee tasks, subtasks, dependencies, saved views and workload · datasets with
duplicate/blur/brightness checks · annotation canvas (boxes or class labels) with review · frozen, leakage-aware
dataset versions · training wizard · per-epoch curves · evaluation labelled by split (train/val/test) ·
confusion matrix and error analysis · Test & Predict · experiment comparison · model registry ·
Markdown documentation with templates · in-app guide and glossary.

## Tests

```
cd web    && npm test              # 61 unit/service tests (real Postgres)
cd web    && npm run e2e           # 55 browser tests incl. a real worker training a model
cd worker && python -m pytest      # real tiny CPU training, evaluation, prediction, export
```
