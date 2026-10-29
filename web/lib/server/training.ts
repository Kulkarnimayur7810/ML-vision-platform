import { z } from "zod";
import { sql, tx } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { can } from "../authz";
import { storage } from "../storage";
import { inspectImage } from "./ingest";
import { log } from "./activity";
import type { Actor } from "./datasets";

export const STALE_SECONDS = 120;
export const ARCHS = {
  detect: [
    { id: "yolov8n", label: "YOLOv8 Nano", note: "Smallest and fastest. Best first choice, especially without a GPU." },
    { id: "yolov8s", label: "YOLOv8 Small", note: "More accurate on small objects, about 3× slower to train." },
    { id: "yolo11n", label: "YOLO11 Nano", note: "Newer nano model." },
    { id: "yolo11s", label: "YOLO11 Small", note: "Newer small model." },
  ],
  classify: [
    { id: "yolov8n-cls", label: "YOLOv8 Nano classifier", note: "Smallest and fastest." },
    { id: "yolov8s-cls", label: "YOLOv8 Small classifier", note: "A bit more accurate, slower." },
    { id: "yolo11n-cls", label: "YOLO11 Nano classifier", note: "Newer nano model." },
    { id: "yolo11s-cls", label: "YOLO11 Small classifier", note: "Newer small model." },
  ],
} as const;

export const runConfigSchema = z.object({
  versionId: z.string().uuid(),
  name: z.string().trim().max(80).optional(),
  arch: z.string().max(40),
  pretrained: z.boolean().default(true),
  epochs: z.number().int().min(1).max(300).default(50),
  imgsz: z.number().int().min(32).max(1280).refine((n) => n % 32 === 0, "Image size must be a multiple of 32").default(640),
  batch: z.number().int().min(1).max(128).default(16),
  lr0: z.number().min(0.00001).max(0.1).default(0.01),
  patience: z.number().int().min(1).max(300).default(50),
  seed: z.number().int().min(0).max(1e9).default(0),
  device: z.enum(["auto", "cpu", "cuda:0"]).default("auto"),
});
export type RunInput = z.infer<typeof runConfigSchema>;

/** Running jobs that stopped heart-beating become 'interrupted' — never 'completed'. */
export async function reconcileStale(workspaceId?: string) {
  const rows = await sql()`update worker_jobs set status = 'interrupted', finished_at = now(), message = 'Worker stopped responding', error = 'The worker stopped sending heartbeats. It may have been shut down or crashed.'
    where status = 'running' and heartbeat_at < now() - make_interval(secs => ${STALE_SECONDS}) and (${workspaceId ?? null}::uuid is null or workspace_id = ${workspaceId ?? null}::uuid) returning id`;
  for (const r of rows) {
    await sql()`update training_runs set status = 'interrupted', finished_at = now(), error = 'The worker stopped responding.' where job_id = ${r.id} and status in ('queued','running')`;
    await sql()`update evaluations set status = 'interrupted', finished_at = now() where job_id = ${r.id} and status in ('queued','running')`;
  }
  return rows.length;
}

export async function workerStatus(workspaceId: string) {
  await reconcileStale(workspaceId);
  const w = await sql()`select id, name, info, last_seen, (last_seen > now() - interval '60 seconds') as online from workers order by last_seen desc limit 20`;
  const [q] = await sql()`select count(*) filter (where status = 'queued')::int as queued, count(*) filter (where status = 'running')::int as running from worker_jobs where workspace_id = ${workspaceId}`;
  return {
    workers: w.map((x) => ({ id: x.id as string, name: x.name as string, info: x.info as Record<string, unknown>, lastSeen: new Date(x.last_seen).toISOString(), online: !!x.online })),
    online: w.some((x) => x.online), queued: q.queued as number, running: q.running as number,
  };
}

const jobOut = (r: Record<string, any>) => ({
  id: r.id as string, kind: r.kind as string, status: r.status as string, progress: Number(r.progress), message: (r.message ?? null) as string | null, error: (r.error ?? null) as string | null,
  cancelRequested: !!r.cancel_requested, createdAt: new Date(r.created_at).toISOString(), startedAt: r.started_at ? new Date(r.started_at).toISOString() : null, finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
  workerId: (r.worker_id ?? null) as string | null, result: (r.result ?? null) as Record<string, unknown> | null, createdBy: (r.created_by_name ?? null) as string | null,
});

export async function listJobs(workspaceId: string) {
  await reconcileStale(workspaceId);
  const rows = await sql()`select j.*, u.display_name as created_by_name from worker_jobs j left join users u on u.id = j.created_by where j.workspace_id = ${workspaceId} order by j.created_at desc limit 100`;
  return rows.map(jobOut);
}

export async function getJob(workspaceId: string, id: string, afterLog = 0) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Job not found");
  await reconcileStale(workspaceId);
  const [r] = await sql()`select j.*, u.display_name as created_by_name from worker_jobs j left join users u on u.id = j.created_by where j.id = ${id} and j.workspace_id = ${workspaceId}`;
  if (!r) throw notFound("Job not found");
  const logs = await sql()`select id, at, line from worker_job_logs where job_id = ${id} and id > ${afterLog} order by id limit 500`;
  return { ...jobOut(r), logs: logs.map((l) => ({ id: Number(l.id), at: new Date(l.at).toISOString(), line: l.line as string })) };
}

export async function cancelJob(a: Actor, jobId: string) {
  if (!can(a.role, "training.run")) throw forbidden();
  const [j] = await sql()`select id, status, kind from worker_jobs where id = ${jobId} and workspace_id = ${a.workspaceId}`;
  if (!j) throw notFound("Job not found");
  if (!["queued", "running"].includes(j.status)) throw conflict("This job already finished.");
  if (j.status === "queued") {
    await sql()`update worker_jobs set status = 'cancelled', finished_at = now(), message = 'Cancelled before it started' where id = ${jobId} and status = 'queued'`;
    await sql()`update training_runs set status = 'cancelled', finished_at = now() where job_id = ${jobId} and status in ('queued','running')`;
    await sql()`update evaluations set status = 'cancelled', finished_at = now() where job_id = ${jobId} and status in ('queued','running')`;
  } else {
    await sql()`update worker_jobs set cancel_requested = true, message = 'Cancelling… (the worker checks every few seconds)' where id = ${jobId}`;
  }
  return { ok: true };
}

/* ───────── training runs ───────── */

const runOut = (r: Record<string, any>) => ({
  id: r.id as string, number: r.number as number, name: r.name as string, status: r.status as string, taskType: r.task_type as "detect" | "classify", arch: r.arch as string, pretrained: !!r.pretrained,
  config: r.config as Record<string, any>, datasetId: r.dataset_id as string, datasetName: (r.dataset_name ?? "") as string, versionId: r.version_id as string, versionNumber: (r.version_number ?? 0) as number,
  jobId: (r.job_id ?? null) as string | null, epochsDone: r.epochs_done as number, bestMetrics: (r.best_metrics ?? null) as Record<string, any> | null, device: (r.device ?? null) as string | null,
  artifacts: (r.artifacts ?? {}) as Record<string, { key: string; bytes: number; sha256: string }>, error: (r.error ?? null) as string | null,
  startedAt: r.started_at ? new Date(r.started_at).toISOString() : null, finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null, createdAt: new Date(r.created_at).toISOString(),
  createdBy: (r.created_by_name ?? null) as string | null, progress: r.job_progress == null ? null : Number(r.job_progress), message: (r.job_message ?? null) as string | null,
});

export async function listRuns(workspaceId: string) {
  await reconcileStale(workspaceId);
  const rows = await sql()`select r.*, d.name as dataset_name, v.number as version_number, u.display_name as created_by_name, j.progress as job_progress, j.message as job_message
    from training_runs r join datasets d on d.id = r.dataset_id join dataset_versions v on v.id = r.version_id
    left join users u on u.id = r.created_by left join worker_jobs j on j.id = r.job_id
    where r.workspace_id = ${workspaceId} order by r.number desc`;
  return rows.map(runOut);
}

export async function getRun(workspaceId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Run not found");
  await reconcileStale(workspaceId);
  const [r] = await sql()`select r.*, d.name as dataset_name, v.number as version_number, u.display_name as created_by_name, j.progress as job_progress, j.message as job_message
    from training_runs r join datasets d on d.id = r.dataset_id join dataset_versions v on v.id = r.version_id
    left join users u on u.id = r.created_by left join worker_jobs j on j.id = r.job_id
    where r.id = ${id} and r.workspace_id = ${workspaceId}`;
  if (!r) throw notFound("Run not found");
  const epochs = await sql()`select epoch, metrics from run_epochs where run_id = ${id} order by epoch`;
  const evals = await sql()`select * from evaluations where run_id = ${id} order by created_at desc`;
  const models = await sql()`select id, name, number, stage from model_versions where run_id = ${id} order by created_at desc`;
  return {
    ...runOut(r),
    epochs: epochs.map((e) => ({ epoch: e.epoch as number, ...(e.metrics as { val: Record<string, number | null>; train_loss: Record<string, number | null>; lr: number | null }) })),
    evaluations: evals.map(evalOut),
    models: models.map((m) => ({ id: m.id as string, name: m.name as string, number: m.number as number, stage: m.stage as string })),
  };
}

export async function createRun(a: Actor, input: RunInput) {
  if (!can(a.role, "training.run")) throw forbidden("Only ML Engineers, Admins and Owners can start training.");
  const [v] = await sql()`select v.id, v.number, v.counts, v.dataset_id, d.task_type, d.name from dataset_versions v join datasets d on d.id = v.dataset_id where v.id = ${input.versionId} and d.workspace_id = ${a.workspaceId}`;
  if (!v) throw notFound("Dataset version not found");
  const task = v.task_type as "detect" | "classify";
  if (!ARCHS[task].some((m) => m.id === input.arch)) throw badRequest(`"${input.arch}" isn't available for ${task === "detect" ? "object detection" : "classification"}.`);
  const counts = (v.counts ?? {}) as Record<string, number>;
  if ((counts.train ?? 0) < 1 || (counts.val ?? 0) < 1) throw badRequest("This version needs at least one image in both the train and validation splits. Create a new version with more approved images.");
  const { versionId, name, ...cfg } = input;
  return tx(async (t) => {
    await t`select pg_advisory_xact_lock(hashtext(${"runs:" + a.workspaceId}))`;
    // Duplicate-submit guard: the same user starting an identical run within 15 s is almost certainly a double click.
    const [dup] = await t`select id from training_runs where workspace_id = ${a.workspaceId} and created_by = ${a.id} and version_id = ${versionId} and arch = ${input.arch} and config = ${t.json(cfg as never)} and created_at > now() - interval '15 seconds'`;
    if (dup) throw conflict("An identical run was just started.", { runId: dup.id });
    const [n] = await t`select coalesce(max(number), 0) + 1 as n from training_runs where workspace_id = ${a.workspaceId}`;
    const runName = name?.trim() || `${v.name} v${v.number} · ${input.arch}`;
    const [run] = await t`insert into training_runs (workspace_id, number, name, dataset_id, version_id, task_type, arch, pretrained, config, created_by)
      values (${a.workspaceId}, ${n.n}, ${runName}, ${v.dataset_id}, ${versionId}, ${task}, ${input.arch}, ${input.pretrained}, ${t.json(cfg as never)}, ${a.id}) returning id, number`;
    const [job] = await t`insert into worker_jobs (workspace_id, kind, params, created_by) values (${a.workspaceId}, 'train', ${t.json({ runId: run.id })}, ${a.id}) returning id`;
    await t`update training_runs set job_id = ${job.id} where id = ${run.id}`;
    await log(t, a.workspaceId, a.id, "training.queued", "run", run.id, `Queued training run #${run.number} (${input.arch})`);
    return { id: run.id as string, number: run.number as number, jobId: job.id as string };
  });
}

export async function retryRun(a: Actor, runId: string) {
  const r = await getRun(a.workspaceId, runId);
  if (!["failed", "cancelled", "interrupted"].includes(r.status)) throw conflict("Only failed, cancelled or interrupted runs can be retried.");
  const { class_names: _c, train_seconds: _t, ...cfg } = r.config as Record<string, any>;
  return createRun(a, { ...(cfg as Omit<RunInput, "versionId" | "name" | "arch" | "pretrained">), versionId: r.versionId, arch: r.arch, pretrained: r.pretrained, name: `${r.name} (retry)` } as RunInput);
}

export async function cancelRun(a: Actor, runId: string) {
  const r = await getRun(a.workspaceId, runId);
  if (!r.jobId) throw conflict("This run has no job.");
  return cancelJob(a, r.jobId);
}

export async function artifactUrl(workspaceId: string, runId: string, which: "best" | "last") {
  const r = await getRun(workspaceId, runId);
  const art = r.artifacts[which];
  if (!art) throw notFound("No such checkpoint for this run.");
  if (!art.key.startsWith(`w/${workspaceId}/`)) throw notFound("No such checkpoint");
  return { url: await storage().url(art.key, 120), bytes: art.bytes, sha256: art.sha256, filename: `run-${r.number}-${which}.pt` };
}

/* ───────── evaluations ───────── */

const evalOut = (e: Record<string, any>) => ({
  id: e.id as string, runId: e.run_id as string, split: e.split as "train" | "val" | "test", status: e.status as string, jobId: (e.job_id ?? null) as string | null,
  metrics: (e.metrics ?? null) as Record<string, any> | null, perClass: (e.per_class ?? null) as Record<string, any>[] | null, confusion: (e.confusion ?? null) as { labels: string[]; matrix: number[][] } | null,
  speed: (e.speed ?? null) as Record<string, any> | null, nImages: (e.n_images ?? null) as number | null, createdAt: new Date(e.created_at).toISOString(), finishedAt: e.finished_at ? new Date(e.finished_at).toISOString() : null,
});

export async function startEvaluation(a: Actor, runId: string, split: "train" | "val" | "test") {
  if (!can(a.role, "training.run")) throw forbidden();
  const r = await getRun(a.workspaceId, runId);
  if (r.status !== "completed" || !r.artifacts.best) throw badRequest("Evaluate a run after training has completed.");
  const [c] = await sql()`select counts from dataset_versions where id = ${r.versionId}`;
  if (((c?.counts as Record<string, number>)?.[split] ?? 0) < 1) throw badRequest(`This dataset version has no images in the ${split} split.`);
  return tx(async (t) => {
    const [open] = await t`select id from evaluations where run_id = ${runId} and split = ${split} and status in ('queued','running')`;
    if (open) throw conflict("An evaluation on this split is already in progress.");
    const [e] = await t`insert into evaluations (workspace_id, run_id, split, created_by) values (${a.workspaceId}, ${runId}, ${split}, ${a.id}) returning id`;
    const [job] = await t`insert into worker_jobs (workspace_id, kind, params, created_by) values (${a.workspaceId}, 'evaluate', ${t.json({ evaluationId: e.id })}, ${a.id}) returning id`;
    await t`update evaluations set job_id = ${job.id} where id = ${e.id}`;
    await log(t, a.workspaceId, a.id, "training.evaluate", "run", runId, `Queued evaluation of run #${r.number} on the ${split} split`);
    return { id: e.id as string, jobId: job.id as string };
  });
}

export async function getEvaluation(workspaceId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Evaluation not found");
  const [e] = await sql()`select * from evaluations where id = ${id} and workspace_id = ${workspaceId}`;
  if (!e) throw notFound("Evaluation not found");
  return evalOut(e);
}

/* ───────── predictions (Test & Predict) ───────── */

export const MAX_PREDICT_BYTES = 4 * 1024 * 1024;

export async function createPrediction(a: Actor, runId: string, file: { name: string; data: Buffer }, conf: number, iou: number) {
  if (!can(a.role, "training.run")) throw forbidden();
  const r = await getRun(a.workspaceId, runId);
  if (r.status !== "completed" || !r.artifacts.best) throw badRequest("Pick a run that has finished training.");
  if (!(conf >= 0.01 && conf <= 0.99) || !(iou >= 0.1 && iou <= 0.95)) throw badRequest("Confidence must be 0.01–0.99 and IoU 0.1–0.95.");
  if (file.data.length > MAX_PREDICT_BYTES) throw badRequest("Files must be under 4 MB here (a hosting limit). Resize the image or trim the video.");
  const isVideo = /\.(mp4|mov|webm|avi)$/i.test(file.name);
  let ext = "mp4";
  if (!isVideo) ext = (await inspectImage(file.data)).ext; // validates it is a real image
  const id = crypto.randomUUID();
  const key = `w/${a.workspaceId}/predict/${id}.${ext}`;
  await storage().put(key, file.data, isVideo ? "video/mp4" : `image/${ext === "jpg" ? "jpeg" : ext}`);
  return tx(async (t) => {
    const [p] = await t`insert into predictions (id, workspace_id, run_id, kind, input_key, filename, conf, iou, created_by) values (${id}, ${a.workspaceId}, ${runId}, ${isVideo ? "video" : "image"}, ${key}, ${file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 100)}, ${conf}, ${iou}, ${a.id}) returning id`;
    const [job] = await t`insert into worker_jobs (workspace_id, kind, params, created_by) values (${a.workspaceId}, 'predict', ${t.json({ predictionId: p.id })}, ${a.id}) returning id`;
    await t`update predictions set job_id = ${job.id} where id = ${p.id}`;
    return { id: p.id as string, jobId: job.id as string };
  });
}

export async function getPrediction(workspaceId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Prediction not found");
  await reconcileStale(workspaceId);
  const [p] = await sql()`select p.*, j.status as job_status, j.error as job_error, j.progress as job_progress from predictions p left join worker_jobs j on j.id = p.job_id where p.id = ${id} and p.workspace_id = ${workspaceId}`;
  if (!p) throw notFound("Prediction not found");
  return {
    id: p.id as string, runId: p.run_id as string, kind: p.kind as "image" | "video", filename: p.filename as string, conf: Number(p.conf), iou: Number(p.iou),
    status: p.result ? "completed" : (p.job_status as string), error: (p.job_error ?? null) as string | null, result: (p.result ?? null) as Record<string, any> | null,
    imageUrl: p.kind === "image" ? await storage().url(p.input_key, 600) : null, createdAt: new Date(p.created_at).toISOString(),
  };
}

/* ───────── dataset export (worker job) ───────── */

export async function queueExport(a: Actor, versionId: string) {
  if (!can(a.role, "datasets.edit")) throw forbidden();
  const [v] = await sql()`select v.id from dataset_versions v join datasets d on d.id = v.dataset_id where v.id = ${versionId} and d.workspace_id = ${a.workspaceId}`;
  if (!v) throw notFound("Dataset version not found");
  const [open] = await sql()`select id from worker_jobs where workspace_id = ${a.workspaceId} and kind = 'export_dataset' and params->>'versionId' = ${versionId} and status in ('queued','running')`;
  if (open) return { jobId: open.id as string };
  const [job] = await sql()`insert into worker_jobs (workspace_id, kind, params, created_by) values (${a.workspaceId}, 'export_dataset', ${sql().json({ versionId })}, ${a.id}) returning id`;
  return { jobId: job.id as string };
}

export async function jobDownloadUrl(workspaceId: string, jobId: string) {
  const [j] = await sql()`select result, status from worker_jobs where id = ${jobId} and workspace_id = ${workspaceId} and kind = 'export_dataset'`;
  const key = (j?.result as { key?: string } | null)?.key;
  if (!j || j.status !== "completed" || !key || !key.startsWith(`w/${workspaceId}/`)) throw notFound("Export not ready");
  return { url: await storage().url(key, 120) };
}
