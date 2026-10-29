import { sql, tx, type Sql } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { can, type Role } from "../authz";
import { log } from "./activity";
import { storage } from "../storage";

export type Actor = { id: string; role: Role; workspaceId: string; slug: string };
export type TaskType = "detect" | "classify";

export const DEFAULT_CLASSES = ["plastic", "paper", "metal", "screw", "e_waste"];

export async function datasetFor(workspaceId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Dataset not found");
  const [d] = await sql()`select id, name, description, task_type, created_at, archived_at from datasets where id = ${id} and workspace_id = ${workspaceId}`;
  if (!d) throw notFound("Dataset not found");
  return { id: d.id as string, name: d.name as string, description: d.description as string, taskType: d.task_type as TaskType, createdAt: new Date(d.created_at).toISOString(), archived: !!d.archived_at };
}

export async function listDatasets(workspaceId: string) {
  const rows = await sql()`
    select d.id, d.name, d.description, d.task_type, d.created_at,
      count(i.id)::int as images,
      count(i.id) filter (where i.status in ('labeled','approved'))::int as labeled,
      count(i.id) filter (where i.status = 'approved')::int as approved,
      (select count(*)::int from dataset_versions v where v.dataset_id = d.id) as versions
    from datasets d left join dataset_images i on i.dataset_id = d.id
    where d.workspace_id = ${workspaceId} and d.archived_at is null group by d.id order by d.created_at desc`;
  return rows.map((r) => ({ id: r.id as string, name: r.name as string, description: r.description as string, taskType: r.task_type as TaskType, images: r.images as number, labeled: r.labeled as number, approved: r.approved as number, versions: r.versions as number, createdAt: new Date(r.created_at).toISOString() }));
}

export async function createDataset(a: Actor, input: { name: string; description?: string; taskType: TaskType; classes?: string[] }) {
  if (!can(a.role, "datasets.create")) throw forbidden();
  const name = input.name.trim();
  if (name.length < 2) throw badRequest("Give the dataset a name.");
  const classes = [...new Set((input.classes ?? DEFAULT_CLASSES).map((c) => c.trim()).filter(Boolean))];
  if (!classes.length) throw badRequest("Add at least one class.");
  if (classes.some((c) => !/^[A-Za-z0-9_\- ]{1,40}$/.test(c))) throw badRequest("Class names may use letters, numbers, spaces, - and _ (max 40).");
  return tx(async (t) => {
    const [dup] = await t`select 1 from datasets where workspace_id = ${a.workspaceId} and lower(name) = lower(${name}) and archived_at is null`;
    if (dup) throw badRequest("A dataset with this name already exists.");
    const [d] = await t`insert into datasets (workspace_id, name, description, task_type, created_by) values (${a.workspaceId}, ${name}, ${input.description ?? ""}, ${input.taskType}, ${a.id}) returning id`;
    for (const [i, c] of classes.entries()) await t`insert into dataset_classes (dataset_id, idx, name) values (${d.id}, ${i}, ${c})`;
    await log(t, a.workspaceId, a.id, "dataset.created", "dataset", d.id, `Created ${input.taskType === "detect" ? "object-detection" : "classification"} dataset ${name}`);
    return d.id as string;
  });
}

export async function listClasses(datasetId: string) {
  const rows = await sql()`select c.idx, c.name, c.guideline,
      (select count(*)::int from boxes b join dataset_images i on i.id = b.image_id where i.dataset_id = c.dataset_id and b.class_index = c.idx) as boxes,
      (select count(*)::int from dataset_images i where i.dataset_id = c.dataset_id and i.class_index = c.idx) as images
    from dataset_classes c where c.dataset_id = ${datasetId} order by c.idx`;
  return rows.map((r) => ({ index: r.idx as number, name: r.name as string, guideline: r.guideline as string, boxes: r.boxes as number, images: r.images as number }));
}

/** Classes are append-only once labels exist, so stored class indexes never shift. */
export async function addClass(a: Actor, datasetId: string, name: string) {
  if (!can(a.role, "datasets.edit")) throw forbidden();
  await datasetFor(a.workspaceId, datasetId);
  const n = name.trim();
  if (!/^[A-Za-z0-9_\- ]{1,40}$/.test(n)) throw badRequest("Class names may use letters, numbers, spaces, - and _ (max 40).");
  await tx(async (t) => {
    await t`select 1 from datasets where id = ${datasetId} for update`;
    const [dup] = await t`select 1 from dataset_classes where dataset_id = ${datasetId} and lower(name) = lower(${n})`;
    if (dup) throw badRequest("That class already exists.");
    const [{ next }] = await t`select coalesce(max(idx) + 1, 0) as next from dataset_classes where dataset_id = ${datasetId}`;
    await t`insert into dataset_classes (dataset_id, idx, name) values (${datasetId}, ${next}, ${n})`;
  });
}
export async function updateClass(a: Actor, datasetId: string, idx: number, patch: { name?: string; guideline?: string }) {
  if (!can(a.role, "datasets.edit")) throw forbidden();
  await datasetFor(a.workspaceId, datasetId);
  const [c] = await sql()`select name, guideline from dataset_classes where dataset_id = ${datasetId} and idx = ${idx}`;
  if (!c) throw notFound("Class not found");
  const name = patch.name?.trim() ?? c.name;
  if (!/^[A-Za-z0-9_\- ]{1,40}$/.test(name)) throw badRequest("Class names may use letters, numbers, spaces, - and _ (max 40).");
  try { await sql()`update dataset_classes set name = ${name}, guideline = ${patch.guideline ?? c.guideline} where dataset_id = ${datasetId} and idx = ${idx}`; }
  catch { throw badRequest("Another class already has that name."); }
}

export async function datasetStats(datasetId: string) {
  const [s] = await sql()`select count(*)::int total,
    count(*) filter (where status = 'unlabeled')::int unlabeled, count(*) filter (where status = 'labeled')::int labeled,
    count(*) filter (where status = 'approved')::int approved, count(*) filter (where status = 'needs_fixes')::int needs_fixes,
    coalesce(sum(bytes),0)::bigint bytes from dataset_images where dataset_id = ${datasetId}`;
  return { total: s.total as number, unlabeled: s.unlabeled as number, labeled: s.labeled as number, approved: s.approved as number, needsFixes: s.needs_fixes as number, bytes: Number(s.bytes) };
}

export type ImageRow = { id: string; filename: string; width: number; height: number; status: string; classIndex: number | null; isBackground: boolean; boxCount: number; thumbUrl: string };
export async function browseImages(datasetId: string, opts: { status?: string; after?: string | null; limit?: number }) {
  const limit = Math.min(opts.limit ?? 48, 100);
  let cursorId: string | null = null;
  if (opts.after) { const [c] = await sql()`select id from dataset_images where id = ${opts.after} and dataset_id = ${datasetId}`; cursorId = (c?.id as string) ?? null; }
  const statusOk = opts.status && ["unlabeled", "labeled", "approved", "needs_fixes"].includes(opts.status) ? opts.status : null;
  const rows = await sql()`
    select i.id, i.filename, i.width, i.height, i.status, i.class_index, i.is_background, i.thumb_key,
      (select count(*)::int from boxes b where b.image_id = i.id) as box_count
    from dataset_images i where i.dataset_id = ${datasetId}
      ${statusOk ? sql()`and i.status = ${statusOk}` : sql()``}
      ${cursorId ? sql()`and (i.created_at, i.id) > ((select created_at from dataset_images where id = ${cursorId}), ${cursorId}::uuid)` : sql()``}
    order by i.created_at, i.id limit ${limit + 1}`;
  const page = rows.slice(0, limit);
  const items: ImageRow[] = await Promise.all(page.map(async (r) => ({ id: r.id, filename: r.filename, width: r.width, height: r.height, status: r.status, classIndex: r.class_index, isBackground: r.is_background, boxCount: r.box_count, thumbUrl: await storage().url(r.thumb_key, 900) })));
  return { items, next: rows.length > limit ? page[page.length - 1].id as string : null };
}

export async function archiveDataset(a: Actor, datasetId: string) {
  if (!can(a.role, "datasets.edit")) throw forbidden();
  const d = await datasetFor(a.workspaceId, datasetId);
  await sql()`update datasets set archived_at = now() where id = ${datasetId}`;
  await log(sql() as Sql, a.workspaceId, a.id, "dataset.archived", "dataset", datasetId, `Archived dataset ${d.name}`);
}
export { conflict };
