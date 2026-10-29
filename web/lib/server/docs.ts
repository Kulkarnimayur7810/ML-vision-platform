import { z } from "zod";
import { sql, tx } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { can } from "../authz";
import { log } from "./activity";
import { templateFor } from "../docs-templates";
import type { Actor } from "./datasets";

const KINDS = ["blank", "meeting", "collection", "labeling", "experiment", "model_card", "report"] as const;
export const linkSchema = z.object({ type: z.enum(["task", "dataset", "run", "model"]), id: z.string().uuid() });
export const createDocSchema = z.object({ title: z.string().trim().min(1).max(160).optional(), kind: z.enum(KINDS).default("blank"), body: z.string().max(200_000).optional() });
export const updateDocSchema = z.object({ version: z.number().int(), title: z.string().trim().min(1).max(160).optional(), body: z.string().max(200_000).optional(), links: z.array(linkSchema).max(50).optional() });

const row = (d: Record<string, any>) => ({ id: d.id as string, title: d.title as string, kind: d.kind as string, version: d.version as number, updatedAt: new Date(d.updated_at).toISOString(), createdAt: new Date(d.created_at).toISOString(), updatedBy: (d.updated_by_name ?? null) as string | null, createdBy: (d.created_by_name ?? null) as string | null });

export async function listDocs(workspaceId: string, q?: string, kind?: string) {
  const like = q?.trim() ? `%${q.trim().replace(/[\\%_]/g, (c) => "\\" + c)}%` : null;
  const rows = await sql()`select d.id, d.title, d.kind, d.version, d.created_at, d.updated_at, u.display_name as updated_by_name,
      case when ${like}::text is not null then substr(d.body, greatest(1, position(lower(${q?.trim() ?? ""}) in lower(d.body)) - 40), 140) else null end as snippet
    from docs d left join users u on u.id = d.updated_by
    where d.workspace_id = ${workspaceId} and d.archived_at is null
      and (${like}::text is null or d.title ilike ${like} or d.body ilike ${like}) and (${kind ?? null}::text is null or d.kind = ${kind ?? null})
    order by d.updated_at desc limit 200`;
  return rows.map((d) => ({ ...row(d), snippet: (d.snippet ?? null) as string | null }));
}

async function resolveLinks(workspaceId: string, docId: string) {
  const links = await sql()`select link_type, ref_id from doc_links where doc_id = ${docId}`;
  const out: { type: string; id: string; title: string; href: string | null }[] = [];
  const [slugRow] = await sql()`select slug from workspaces where id = ${workspaceId}`;
  const slug = slugRow.slug as string;
  for (const l of links) {
    const id = l.ref_id as string;
    if (l.link_type === "task") { const [t] = await sql()`select number, title from tasks where id = ${id} and workspace_id = ${workspaceId}`; out.push({ type: "task", id, title: t ? `#${t.number} ${t.title}` : "(removed task)", href: t ? `/w/${slug}/kanban/tasks/${t.number}` : null }); }
    if (l.link_type === "dataset") { const [t] = await sql()`select name from datasets where id = ${id} and workspace_id = ${workspaceId}`; out.push({ type: "dataset", id, title: t?.name ?? "(removed dataset)", href: t ? `/w/${slug}/datasets/${id}` : null }); }
    if (l.link_type === "run") { const [t] = await sql()`select number, name from training_runs where id = ${id} and workspace_id = ${workspaceId}`; out.push({ type: "run", id, title: t ? `Run #${t.number} ${t.name}` : "(removed run)", href: t ? `/w/${slug}/training/${id}` : null }); }
    if (l.link_type === "model") { const [t] = await sql()`select name, number from model_versions where id = ${id} and workspace_id = ${workspaceId}`; out.push({ type: "model", id, title: t ? `${t.name} v${t.number}` : "(removed model)", href: t ? `/w/${slug}/models` : null }); }
  }
  return out;
}

export async function getDoc(workspaceId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Document not found");
  const [d] = await sql()`select d.*, u.display_name as updated_by_name, c.display_name as created_by_name from docs d left join users u on u.id = d.updated_by left join users c on c.id = d.created_by where d.id = ${id} and d.workspace_id = ${workspaceId} and d.archived_at is null`;
  if (!d) throw notFound("Document not found");
  return { ...row(d), body: d.body as string, links: await resolveLinks(workspaceId, id) };
}

export async function createDoc(a: Actor, input: Partial<z.infer<typeof createDocSchema>>) {
  if (!can(a.role, "docs.edit")) throw forbidden();
  const kind = input.kind ?? "blank";
  const t = templateFor(kind);
  const title = input.title ?? t.title;
  const [d] = await sql()`insert into docs (workspace_id, title, body, kind, created_by, updated_by) values (${a.workspaceId}, ${title}, ${input.body ?? t.body}, ${kind}, ${a.id}, ${a.id}) returning id`;
  await log(sql(), a.workspaceId, a.id, "doc.created", "doc", d.id, `Created document "${title}"`);
  return { id: d.id as string };
}

async function validateLinks(t: ReturnType<typeof sql>, workspaceId: string, links: z.infer<typeof linkSchema>[]) {
  const table = { task: "tasks", dataset: "datasets", run: "training_runs", model: "model_versions" } as const;
  for (const l of links) {
    const [ok] = await t.unsafe(`select 1 from ${table[l.type]} where id = $1 and workspace_id = $2`, [l.id, workspaceId]);
    if (!ok) throw badRequest(`That ${l.type} doesn't exist in this workspace.`);
  }
}

export async function updateDoc(a: Actor, id: string, p: z.infer<typeof updateDocSchema>) {
  if (!can(a.role, "docs.edit")) throw forbidden();
  await getDoc(a.workspaceId, id);
  return tx(async (t) => {
    const [cur] = await t`select version, title from docs where id = ${id} and workspace_id = ${a.workspaceId} and archived_at is null for update`;
    if (!cur) throw notFound("Document not found");
    if (cur.version !== p.version) throw conflict("Someone else edited this document after you opened it. Copy your changes, reload, and merge them.", { currentVersion: cur.version });
    if (p.links) await validateLinks(t as never, a.workspaceId, p.links);
    const [u] = await t`update docs set title = coalesce(${p.title ?? null}, title), body = coalesce(${p.body ?? null}, body), version = version + 1, updated_at = now(), updated_by = ${a.id} where id = ${id} returning version`;
    if (p.links) {
      await t`delete from doc_links where doc_id = ${id}`;
      for (const l of p.links) await t`insert into doc_links (doc_id, link_type, ref_id) values (${id}, ${l.type}, ${l.id}) on conflict do nothing`;
    }
    await log(t, a.workspaceId, a.id, "doc.updated", "doc", id, `Edited document "${p.title ?? cur.title}"`);
    return { version: u.version as number };
  });
}

/** Archive, not delete — same rule as tasks. */
export async function archiveDoc(a: Actor, id: string) {
  if (!can(a.role, "docs.edit")) throw forbidden();
  const d = await getDoc(a.workspaceId, id);
  await sql()`update docs set archived_at = now() where id = ${id}`;
  await log(sql(), a.workspaceId, a.id, "doc.archived", "doc", id, `Archived document "${d.title}"`);
  return { ok: true };
}

/** Real numbers for a run, each labelled with the split it came from. Used by "Insert run results". */
export async function runSnapshot(workspaceId: string, runId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw notFound("Run not found");
  const [r] = await sql()`select r.number, r.name, r.arch, r.task_type, r.pretrained, r.config, r.best_metrics, r.status, d.name as dataset, v.number as version from training_runs r join datasets d on d.id = r.dataset_id join dataset_versions v on v.id = r.version_id where r.id = ${runId} and r.workspace_id = ${workspaceId}`;
  if (!r) throw notFound("Run not found");
  const evals = await sql()`select distinct on (split) split, metrics, n_images from evaluations where run_id = ${runId} and status = 'completed' order by split, created_at desc`;
  const p = (v: unknown) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "n/a");
  const det = r.task_type === "detect";
  const lines = [`### Run #${r.number}: ${r.name}`, "", `- Data: ${r.dataset} v${r.version}`, `- Model: ${r.arch}${r.pretrained ? " (pretrained)" : " (from scratch)"}, ${r.config.epochs} epochs, ${r.config.imgsz}px, batch ${r.config.batch}`, `- Status: ${r.status}`, ""];
  const head = det ? "| Split | Images | Precision | Recall | mAP@50 | mAP@50-95 |\n|---|---|---|---|---|---|" : "| Split | Images | Top-1 | Top-5 |\n|---|---|---|---|";
  const rows: string[] = [];
  const bm = r.best_metrics as Record<string, number> | null;
  if (bm) rows.push(det ? `| validation (best epoch ${bm.epoch}, used for training) | — | ${p(bm["metrics/precision(B)"])} | ${p(bm["metrics/recall(B)"])} | ${p(bm["metrics/mAP50(B)"])} | ${p(bm["metrics/mAP50-95(B)"])} |` : `| validation (best epoch ${bm.epoch}, used for training) | — | ${p(bm["metrics/accuracy_top1"])} | ${p(bm["metrics/accuracy_top5"])} |`);
  for (const e of evals) { const m = e.metrics as Record<string, number>; rows.push(det ? `| ${e.split} (evaluated) | ${e.n_images} | ${p(m.precision)} | ${p(m.recall)} | ${p(m.map50)} | ${p(m.map5095)} |` : `| ${e.split} (evaluated) | ${e.n_images} | ${p(m.top1)} | ${p(m.top5)} |`); }
  if (!evals.some((e) => e.split === "test")) rows.push(`| test | — | not evaluated yet | | | |`);
  return { markdown: [...lines, head, ...rows, ""].join("\n") };
}
