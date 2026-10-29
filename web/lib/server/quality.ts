import { sql } from "../db";
import { datasetFor } from "./datasets";

export type Issue = { code: string; severity: "error" | "warning" | "info"; count: number; title: string; help: string; imageIds: string[] };
const hamming = (a: string, b: string) => { let x = BigInt("0x" + a) ^ BigInt("0x" + b), n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };
export const NEAR_DUP_DISTANCE = 4;

/** Union-find groups of near-identical images (Hamming ≤ 4 on 64-bit dHash). Fine for a few thousand images. */
export function nearDuplicateGroups(rows: { id: string; dhash: string | null }[]): string[][] {
  const items = rows.filter((r) => r.dhash);
  const parent = new Map(items.map((r) => [r.id, r.id]));
  const find = (x: string): string => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (hamming(items[i].dhash!, items[j].dhash!) <= NEAR_DUP_DISTANCE) parent.set(find(items[i].id), find(items[j].id));
  const groups = new Map<string, string[]>();
  for (const r of items) { const k = find(r.id); groups.set(k, [...(groups.get(k) ?? []), r.id]); }
  return [...groups.values()].filter((g) => g.length > 1);
}

export async function qualityReport(workspaceId: string, datasetId: string) {
  const ds = await datasetFor(workspaceId, datasetId);
  const db = sql();
  const ids = (rows: readonly Record<string, any>[]) => rows.slice(0, 50).map((r) => r.id as string);
  const issues: Issue[] = [];
  const unlabeled = await db`select id from dataset_images where dataset_id = ${datasetId} and status = 'unlabeled'`;
  if (unlabeled.length) issues.push({ code: "unlabeled", severity: "warning", count: unlabeled.length, title: "Images without labels", help: "Label these or leave them out. Only approved images go into a training version.", imageIds: ids(unlabeled) });
  const fixes = await db`select id from dataset_images where dataset_id = ${datasetId} and status = 'needs_fixes'`;
  if (fixes.length) issues.push({ code: "needs_fixes", severity: "warning", count: fixes.length, title: "Sent back for fixes", help: "A reviewer asked for changes. Open each one to see the note.", imageIds: ids(fixes) });
  const dark = await db`select id from dataset_images where dataset_id = ${datasetId} and brightness < 25`;
  const bright = await db`select id from dataset_images where dataset_id = ${datasetId} and brightness > 235`;
  if (dark.length + bright.length) issues.push({ code: "exposure", severity: "info", count: dark.length + bright.length, title: "Very dark or very bright images", help: "Objects may be hard to see. Retake or exclude them.", imageIds: ids([...dark, ...bright]) });
  const blurry = await db`select id from dataset_images where dataset_id = ${datasetId} and blur < 30`;
  if (blurry.length) issues.push({ code: "blur", severity: "info", count: blurry.length, title: "Possibly blurry images", help: "Low edge sharpness. Small objects in blurry photos are very hard to detect.", imageIds: ids(blurry) });
  const small = await db`select id from dataset_images where dataset_id = ${datasetId} and least(width, height) < 320`;
  if (small.length) issues.push({ code: "low_res", severity: "info", count: small.length, title: "Low-resolution images (<320 px)", help: "Small waste items need enough pixels. Consider higher resolution for 2–5 cm objects.", imageIds: ids(small) });
  const dhashRows = await db`select id, dhash from dataset_images where dataset_id = ${datasetId} order by created_at limit 5000`;
  const groups = nearDuplicateGroups(dhashRows as never);
  if (groups.length) issues.push({ code: "near_duplicates", severity: "warning", count: groups.reduce((n, g) => n + g.length, 0), title: `${groups.length} group${groups.length > 1 ? "s" : ""} of near-duplicate images`, help: "Almost identical photos. They are always placed in the same split so validation results aren't inflated, but consider keeping one.", imageIds: groups.flat().slice(0, 50) });
  if (ds.taskType === "detect") {
    const tiny = await db`select distinct b.image_id as id from boxes b join dataset_images i on i.id = b.image_id where i.dataset_id = ${datasetId} and (b.w * i.width < 8 or b.h * i.height < 8)`;
    if (tiny.length) issues.push({ code: "tiny_boxes", severity: "warning", count: tiny.length, title: "Boxes under 8 pixels", help: "Probably mis-clicks. Check or delete them.", imageIds: ids(tiny) });
    const dupBoxes = await db`select distinct a.image_id as id from boxes a join boxes b on a.image_id = b.image_id and a.id < b.id and a.class_index = b.class_index
      join dataset_images i on i.id = a.image_id where i.dataset_id = ${datasetId}
      and (least(a.cx + a.w/2, b.cx + b.w/2) - greatest(a.cx - a.w/2, b.cx - b.w/2)) > 0
      and (least(a.cy + a.h/2, b.cy + b.h/2) - greatest(a.cy - a.h/2, b.cy - b.h/2)) > 0
      and ((least(a.cx + a.w/2, b.cx + b.w/2) - greatest(a.cx - a.w/2, b.cx - b.w/2)) * (least(a.cy + a.h/2, b.cy + b.h/2) - greatest(a.cy - a.h/2, b.cy - b.h/2)))
        / nullif(a.w*a.h + b.w*b.h - ((least(a.cx + a.w/2, b.cx + b.w/2) - greatest(a.cx - a.w/2, b.cx - b.w/2)) * (least(a.cy + a.h/2, b.cy + b.h/2) - greatest(a.cy - a.h/2, b.cy - b.h/2))), 0) > 0.9`;
    if (dupBoxes.length) issues.push({ code: "duplicate_boxes", severity: "warning", count: dupBoxes.length, title: "Duplicate boxes (IoU > 0.9, same class)", help: "The same object is boxed twice. Delete one.", imageIds: ids(dupBoxes) });
  }
  const classes = await db`select c.name, c.idx,
      (select count(*)::int from boxes b join dataset_images i on i.id = b.image_id where i.dataset_id = c.dataset_id and b.class_index = c.idx) as boxes,
      (select count(*)::int from dataset_images i where i.dataset_id = c.dataset_id and i.class_index = c.idx) as images
    from dataset_classes c where c.dataset_id = ${datasetId} order by c.idx`;
  const counts = classes.map((c) => ({ name: c.name as string, count: (ds.taskType === "detect" ? c.boxes : c.images) as number }));
  const thin = counts.filter((c) => c.count < 10);
  if (thin.length) issues.push({ code: "few_examples", severity: "warning", count: thin.length, title: "Classes with fewer than 10 examples", help: `${thin.map((c) => `${c.name} (${c.count})`).join(", ")}. Models rarely learn a class from so few examples; aim for at least 100.`, imageIds: [] });
  return { taskType: ds.taskType, issues, distribution: counts };
}
