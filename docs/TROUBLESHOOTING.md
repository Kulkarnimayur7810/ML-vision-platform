# Troubleshooting

| Symptom | Likely cause → fix |
|---|---|
| “No worker is online” banner; jobs stay **Queued** | No worker is running, or it can't reach the database. Start it (`python -m wvworker run`), run `python -m wvworker check`, see **Jobs & workers**. |
| Run says **Interrupted** | The worker stopped for >2 minutes (sleep, crash, network). Start it again, then **Retry with same settings**. Nothing was marked complete. |
| Run **Failed**, log mentions “GPU requested but this worker has none” | The run was set to GPU 0. Retry with Device = Automatic or CPU. |
| Training is extremely slow | CPU only. Use the Nano model, a smaller image size and fewer epochs, or a machine with an NVIDIA GPU. |
| Out-of-memory in the worker log | Lower the batch size or image size. |
| First run hangs on “Loading model” | Pretrained weights are downloading (needs internet once), or turn pretrained off. |
| Upload says larger than 4 MB | Hosting request limit. Resize photos, or upload fewer per batch. |
| `Local storage can't be used on Vercel` | Set `STORAGE_DRIVER=s3` and the `S3_*` variables in Vercel. |
| Images or downloads 404 / expired | Links are short-lived; reload the page. On S3, confirm bucket/endpoint and that the key exists. |
| `Workspace not found` after signing in | You are not a member of that workspace (or the slug is wrong). Ask an owner to add you. |
| Locked out after failed sign-ins | Wait 15 minutes, or an owner/admin resets the password from Team. |
| Owner forgot the password | From a trusted computer with `DATABASE_URL`: `FORCE_ADD_OWNER=1 npm run create-owner` creates another owner (use a different email), then reset the old account from Team. |
| `prepared statement … does not exist` / pgbouncer errors | Using the transaction pooler where a direct/session connection is needed (worker, migrations). The website itself is configured for the pooler. |
| `npm run migrate` hangs | Another migration is running (advisory lock), or you used a pooler that blocks DDL. Use the direct connection. |
| Evaluation says “no images in the test split” | The dataset version has none. Create a new version with more approved images. |
| Metrics look too good | You are looking at the **validation** split. Use *Evaluate on test*. |
