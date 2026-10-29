import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { closeSql, makeWorkspace, resetDb } from "../helpers/db";
import { sql } from "@/lib/db";
import { mlSummary } from "@/lib/server/overview";
import * as T from "@/lib/server/training";

beforeAll(async () => { await resetDb(); });
afterAll(closeSql);

describe("overview summary", () => {
  it("starts empty and points at the first real step", async () => {
    const w = await makeWorkspace();
    const s = await mlSummary(w.id, w.slug);
    expect(s).toMatchObject({ datasets: 0, images: 0, versions: 0, runs: { total: 0 }, models: { total: 0, selected: null }, latest: null });
    expect(s.next.text).toMatch(/first dataset/);
  });
  it("reports only stored results; unevaluated scores stay null; other workspaces are excluded", async () => {
    const w = await makeWorkspace(), o = await makeWorkspace();
    const [d] = await sql()`insert into datasets (workspace_id, name, task_type) values (${w.id}, 'D', 'detect') returning id`;
    for (let i = 0; i < 4; i++) await sql()`insert into dataset_images (dataset_id, filename, storage_key, thumb_key, sha256, width, height, bytes, status) values (${d.id}, ${"i" + i}, 'k', 't', ${"s" + i}, 1, 1, 1, ${i < 3 ? "approved" : "labeled"})`;
    const [v] = await sql()`insert into dataset_versions (dataset_id, number, name, seed, ratios, classes, counts) values (${d.id}, 1, 'v1', 1, ${sql().json({})}, ${sql().json([])}, ${sql().json({ train: 2, val: 1, test: 0 })}) returning id`;
    const r = await T.createRun(w.actor(), T.runConfigSchema.parse({ versionId: v.id, arch: "yolov8n" }));
    await sql()`update training_runs set status = 'completed', finished_at = now(), best_metrics = ${sql().json({ "metrics/mAP50(B)": 0.42 })} where id = ${r.id}`;
    const s = await mlSummary(w.id, w.slug);
    expect(s).toMatchObject({ datasets: 1, images: 4, approved: 3, labeled: 4, versions: 1, runs: { total: 1, completed: 1 } });
    expect(s.latest).toMatchObject({ valScore: 0.42, testScore: null });
    expect(s.next.text).toMatch(/Evaluate your latest run on the test split/);
    expect((await mlSummary(o.id, o.slug)).datasets).toBe(0);
  });
});
