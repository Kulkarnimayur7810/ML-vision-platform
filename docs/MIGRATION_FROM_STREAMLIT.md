# Relationship to the earlier Streamlit tool

The first version of WasteVision AI was a single-user Streamlit app (dataset management, annotation, YOLO training,
evaluation, export). **Its original Python source was lost in a workspace reset** before this web version was
written; only `app.py` (the entry point) and its README survived. The web platform was therefore **rebuilt from
the specification, not ported line by line**. Behaviour that mattered was kept (private login, roles, datasets,
annotation, versions, real training and honest metrics); implementation, storage and database are new.

## What carried over
Dataset → annotate → review → version → train → evaluate → register → export; admin-managed accounts; real
Ultralytics training (no simulated metrics); a Kanban board.

## What changed
| Before | Now |
|---|---|
| Streamlit session in one process | Next.js app + Postgres; many people at once |
| Training inside the app process | Separate Python worker with a job queue, heartbeats and honest statuses |
| SQLite / local folders | Postgres + S3-compatible storage |
| Setup-code first-run screen, Google OAuth | `npm run create-owner`; email + password only |

## Not carried over (honest list)
- Google Drive import and Google sign-in (intentionally dropped: private email + password only).
- Bulk/zip image import — upload is up to 10 images (≤4 MB total) per request. Exports exist; imports from zip do not.
- Annotation import from YOLO/COCO files.
- Any data in an old Streamlit database: there is no automated migration. Re-upload images (duplicates are
  detected by content hash) and re-label, or export from the old tool and upload.
