import { createHash } from "node:crypto";
import { sql, tx } from "../db";
import { badRequest, forbidden, notFound } from "../errors";
import { can } from "../authz";
import { datasetFor, type Actor } from "./datasets";
import { log } from "./activity";
import { nearDuplicateGroups } from "./quality";

export type Ratios = { train: number; val: number; test: number };
export type Split = "train" | "val" | "test";

const h = (seed: number, key: string) => createHash("sha256").update(`${seed}:${key}`).digest().readUInt32BE(0);

/**
 * Deterministic, leakage-aware split. Near-duplicate groups move together; groups already in a previous
 * version's test split stay in test (holdout is never reused for training).
 */
export function assignSplits(images: { id: string; sha256: string }[], groups: string[][], ratios: Ratios, seed: number, lockedTest: Set<string>): Map<string, Split> {
  const unitOf = new Map<string, string[]>();
  for (const g of groups) for (const id of g) unitOf.set(id, g);
  const units: { key: string; ids: string[]; sha: string }[] = [];
  const seen = new Set<string>();
  const sha = new Map(images.map((i) => [i.id, i.sha256]));
  for (const i of images) {
    if (seen.has(i.id)) continue;
    const ids = (unitOf.get(i.id) ?? [i.id]).filter((id) => sha.has(id));
    ids.forEach((id) => seen.add(id));
    units.push({ key: ids.map((id) => sha.get(id)).sort().join(","), ids, sha: i.sha256 });
  }
  const out = new Map<string, Split>();
  const free: typeof units = [];
  for (const u of units) {
    if (u.ids.some((id) => lockedTest.has(id))) u.ids.forEach((id) => out.set(id, "test"));
    else free.push(u);
  }
  free.sort((a, b) => h(seed, a.key) - h(seed, b.key));
  const total = images.length, nTest = Math.max(0, Math.round(total * ratios.test)), nVal = Math.round(total * ratios.val);
  let wantTest = Math.max(nTest - [...out.values()].length, 0), wantVal = nVal;
  if (total >= 3) { if (ratios.test > 0 && nTest === 0) wantTest = 1; if (ratios.val > 0 && nVal === 0) wantVal = 1; }
  let t = 0, v = 0;
  for (const u of free) {
    const split: Split = t < wantTest ? "test" : v < wantVal ? "val" : "train";
    if (split === "test") t += u.ids.length; else if (split === "val") v += u.ids.length;
    u.ids.forEach((id) => out.set(id, split));
  }
  return out;
}

export async function createVersion(a: Actor, datasetId: string, input: { name?: string; ratios?: Ratios; seed?: number }) {
  if (!can(a.role, "datasets.edit")) throw forbidden();
  const ds = await datasetFor(a.workspaceId, datasetId);
  const ratios = input.ratios ?? { train: 0.7, val: 0.2, test: 0.1 };
  const sum = ratios.train + ratios.val + ratios.test;
  if (Math.abs(sum - 1) > 0.001 || ratios.train <= 0 || ratios.val < 0 || ratios.test < 0) throw badRequest("Split ratios must be positive and add up to 100%.");
  const seed = input.seed ?? 42;
  return tx(async (t) => {
    await t`select 1 from datasets where id = ${datasetId} for update`;
    const images = await t`select id, sha256, dhash, status, class_index, is_background from dataset_images where dataset_id = ${datasetId} and status = 'approved' order by created_at, id`;
    if (images.length < 3) throw badRequest(`Only ${images.length} approved image${images.length === 1 ? "" : "s"}. Approve at least 3 images (more is better) before creating a version.`);
    const classes = await t`select idx, name from dataset_classes where dataset_id = ${datasetId} order by idx`;
    const used = new Set<number>();
    if (ds.taskType === "classify") images.forEach((i) => i.class_index != null && used.add(i.class_index));
    else (await t`select distinct b.class_index from boxes b join dataset_images i on i.id = b.image_id where i.dataset_id = ${datasetId} and i.status = 'approved'`).forEach((r) => used.add(r.class_index));
    if (ds.taskType === "detect") {
      const [{ n }] = await t`select count(*)::int n from boxes b join dataset_images i on i.id = b.image_id where i.dataset_id = ${datasetId} and i.status = 'approved'`;
      if (n === 0) throw badRequest("None of the approved images contain any boxes, so there is nothing to train on.");
    }
    const prev = await t`select vi.image_id from version_images vi join dataset_versions v on v.id = vi.version_id where v.dataset_id = ${datasetId} and vi.split = 'test'`;
    const locked = new Set(prev.map((r) => r.image_id as string));
    const splits = assignSplits(images as never, nearDuplicateGroups(images as never), ratios, seed, new Set([...locked].filter((id) => images.some((i) => i.id === id))));
    const [{ n: num }] = await t`select coalesce(max(number), 0) + 1 as n from dataset_versions where dataset_id = ${datasetId}`;
    const counts = { train: 0, val: 0, test: 0, total: images.length } as Record<string, number>;
    for (const s of splits.values()) counts[s]++;
    if (counts.val === 0 && ratios.val > 0) throw badRequest("Too few images to create a validation split. Approve more images.");
    const [v] = await t`insert into dataset_versions (dataset_id, number, name, seed, ratios, created_by, classes, counts)
      values (${datasetId}, ${num}, ${input.name?.trim() || `v${num}`}, ${seed}, ${t.json(ratios)}, ${a.id}, ${t.json(classes.map((c) => ({ index: c.idx, name: c.name })))}, ${t.json(counts)}) returning id`;
    for (const img of images) {
      const boxes = ds.taskType === "detect" ? (await t`select class_index, cx, cy, w, h from boxes where image_id = ${img.id} order by id`).map((b) => ({ classIndex: b.class_index, cx: b.cx, cy: b.cy, w: b.w, h: b.h })) : [];
      await t`insert into version_images (version_id, image_id, split, class_index, boxes) values (${v.id}, ${img.id}, ${splits.get(img.id)!}, ${img.class_index}, ${t.json(boxes)})`;
    }
    await log(t, a.workspaceId, a.id, "dataset.version", "dataset", datasetId, `Created ${ds.name} version v${num} (${counts.train}/${counts.val}/${counts.test})`);
    return { id: v.id as string, number: num as number, counts, unusedClasses: classes.filter((c) => !used.has(c.idx)).map((c) => c.name as string), keptTest: locked.size };
  });
}

export async function listVersions(workspaceId: string, datasetId: string) {
  await datasetFor(workspaceId, datasetId);
  const rows = await sql()`select v.id, v.number, v.name, v.seed, v.ratios, v.counts, v.classes, v.created_at, u.display_name as by from dataset_versions v left join users u on u.id = v.created_by where v.dataset_id = ${datasetId} order by v.number desc`;
  return rows.map((r) => ({ id: r.id as string, number: r.number as number, name: r.name as string, seed: r.seed as number, ratios: r.ratios as Ratios, counts: r.counts as Record<string, number>, classes: r.classes as { index: number; name: string }[], createdAt: new Date(r.created_at).toISOString(), createdBy: (r.by as string) ?? null }));
}
export async function versionFor(workspaceId: string, versionId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) throw notFound("Version not found");
  const [v] = await sql()`select v.id, v.dataset_id, v.number, v.name from dataset_versions v join datasets d on d.id = v.dataset_id where v.id = ${versionId} and d.workspace_id = ${workspaceId}`;
  if (!v) throw notFound("Version not found");
  return { id: v.id as string, datasetId: v.dataset_id as string, number: v.number as number, name: v.name as string };
}
