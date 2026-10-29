import { z } from "zod";
import { sql, tx } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { can } from "../authz";
import { storage } from "../storage";
import { log } from "./activity";
import type { Actor } from "./datasets";
import { getRun } from "./training";

export const registerSchema = z.object({ runId: z.string().uuid(), name: z.string().trim().min(2).max(60).regex(/^[A-Za-z0-9][A-Za-z0-9 _\-.]*$/, "Use letters, numbers, spaces, - _ ."), notes: z.string().max(1000).default("") });
export const patchSchema = z.object({ stage: z.enum(["candidate", "selected", "archived"]).optional(), notes: z.string().max(1000).optional(), confirmReplace: z.boolean().optional() });

const out = (m: Record<string, any>) => ({
  id: m.id as string, name: m.name as string, number: m.number as number, stage: m.stage as "candidate" | "selected" | "archived", notes: m.notes as string,
  taskType: m.task_type as string, arch: m.arch as string, sizeBytes: Number(m.size_bytes), sha256: m.sha256 as string, classes: m.classes as string[],
  runId: m.run_id as string, runNumber: (m.run_number ?? null) as number | null, datasetName: (m.dataset_name ?? null) as string | null, versionNumber: (m.version_number ?? null) as number | null,
  bestMetrics: (m.best_metrics ?? null) as Record<string, any> | null, createdAt: new Date(m.created_at).toISOString(), createdBy: (m.created_by_name ?? null) as string | null,
  testMetrics: (m.test_metrics ?? null) as Record<string, any> | null,
});

const SELECT = (ws: string, id: string | null = null) => sql()`
  select m.*, r.number as run_number, r.best_metrics, d.name as dataset_name, v.number as version_number, u.display_name as created_by_name,
    (select e.metrics from evaluations e where e.run_id = m.run_id and e.split = 'test' and e.status = 'completed' order by e.created_at desc limit 1) as test_metrics
  from model_versions m join training_runs r on r.id = m.run_id join datasets d on d.id = r.dataset_id join dataset_versions v on v.id = r.version_id left join users u on u.id = m.created_by
  where m.workspace_id = ${ws} and (${id}::uuid is null or m.id = ${id}::uuid) order by m.name, m.number desc`;

export async function listModels(workspaceId: string) { return (await SELECT(workspaceId)).map(out); }

export async function getModel(workspaceId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Model not found");
  const [m] = await SELECT(workspaceId, id);
  if (!m) throw notFound("Model not found");
  return out(m);
}

/** Registering always creates a NEW immutable version of the name; an existing version is never overwritten. */
export async function registerModel(a: Actor, input: z.infer<typeof registerSchema>) {
  if (!can(a.role, "models.manage")) throw forbidden("Only ML Engineers, Admins and Owners can register models.");
  const run = await getRun(a.workspaceId, input.runId);
  const best = run.artifacts.best;
  if (run.status !== "completed" || !best) throw badRequest("Only a completed run with a saved checkpoint can be registered.");
  const names = (run.config.class_names ?? {}) as Record<string, string>;
  const classes = Object.keys(names).sort((x, y) => +x - +y).map((k) => names[k]);
  return tx(async (t) => {
    await t`select pg_advisory_xact_lock(hashtext(${"models:" + a.workspaceId + ":" + input.name.toLowerCase()}))`;
    const [dup] = await t`select 1 from model_versions where workspace_id = ${a.workspaceId} and run_id = ${run.id} and lower(name) = lower(${input.name})`;
    if (dup) throw conflict("This run is already registered under that name.");
    const [n] = await t`select coalesce(max(number), 0) + 1 as n, (select name from model_versions where workspace_id = ${a.workspaceId} and lower(name) = lower(${input.name}) limit 1) as canon from model_versions where workspace_id = ${a.workspaceId} and lower(name) = lower(${input.name})`;
    const name = (n.canon as string | null) ?? input.name; // keep the original capitalisation of an existing name
    const [m] = await t`insert into model_versions (workspace_id, run_id, name, number, artifact_key, size_bytes, sha256, classes, task_type, arch, notes, created_by)
      values (${a.workspaceId}, ${run.id}, ${name}, ${n.n}, ${best.key}, ${best.bytes}, ${best.sha256}, ${t.json(classes as never)}, ${run.taskType}, ${run.arch}, ${input.notes}, ${a.id}) returning id, number`;
    await log(t, a.workspaceId, a.id, "model.registered", "model", m.id, `Registered ${name} v${m.number} from run #${run.number}`);
    return { id: m.id as string, name, number: m.number as number };
  });
}

export async function updateModel(a: Actor, id: string, p: z.infer<typeof patchSchema>) {
  if (!can(a.role, "models.manage")) throw forbidden();
  const m = await getModel(a.workspaceId, id);
  return tx(async (t) => {
    if (p.stage === "selected" && m.stage !== "selected") {
      const [cur] = await t`select id, number from model_versions where workspace_id = ${a.workspaceId} and name = ${m.name} and stage = 'selected' and id <> ${id} for update`;
      if (cur && !p.confirmReplace) throw conflict(`v${cur.number} of "${m.name}" is currently selected. Confirm to replace it (it moves back to candidate).`, { currentSelected: cur.number, needsConfirm: true });
      if (cur) await t`update model_versions set stage = 'candidate' where id = ${cur.id}`;
    }
    await t`update model_versions set stage = ${p.stage ?? m.stage}, notes = ${p.notes ?? m.notes} where id = ${id}`;
    if (p.stage && p.stage !== m.stage) await log(t, a.workspaceId, a.id, "model.stage", "model", id, `${m.name} v${m.number}: ${m.stage} → ${p.stage}`);
    return { ok: true };
  });
}

export async function modelDownload(workspaceId: string, id: string) {
  const m = await getModel(workspaceId, id);
  const [row] = await sql()`select artifact_key from model_versions where id = ${id} and workspace_id = ${workspaceId}`;
  const key = row?.artifact_key as string;
  if (!key?.startsWith(`w/${workspaceId}/`)) throw notFound("Model file not found");
  return { url: await storage().url(key, 120), filename: `${m.name.replace(/\W+/g, "_")}-v${m.number}.pt` };
}

/** Side-by-side comparison on identical metric definitions. Only runs of the same task are comparable. */
export async function compareRuns(workspaceId: string, ids: string[]) {
  if (ids.length < 2 || ids.length > 6) throw badRequest("Pick 2 to 6 runs to compare.");
  const runs = await Promise.all([...new Set(ids)].map((i) => getRun(workspaceId, i)));
  if (new Set(runs.map((r) => r.taskType)).size > 1) throw badRequest("Detection and classification runs can't be compared — their metrics mean different things.");
  const latest = (r: (typeof runs)[number], split: string) => r.evaluations.find((e) => e.split === split && e.status === "completed") ?? null;
  const versions = new Set(runs.map((r) => r.versionId));
  return {
    taskType: runs[0].taskType,
    sameDataVersion: versions.size === 1,
    runs: runs.map((r) => ({
      id: r.id, number: r.number, name: r.name, status: r.status, arch: r.arch, pretrained: r.pretrained, datasetName: r.datasetName, versionNumber: r.versionNumber, versionId: r.versionId,
      config: { epochs: r.config.epochs, imgsz: r.config.imgsz, batch: r.config.batch, lr0: r.config.lr0, seed: r.config.seed, device: r.device },
      epochsDone: r.epochsDone, seconds: (r.config.train_seconds ?? null) as number | null,
      val: r.bestMetrics, test: latest(r, "test")?.metrics ?? null, valEval: latest(r, "val")?.metrics ?? null,
      curve: r.epochs.map((e) => ({ epoch: e.epoch, ...e.val })),
    })),
  };
}
