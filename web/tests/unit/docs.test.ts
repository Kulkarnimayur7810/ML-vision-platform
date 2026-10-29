import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { closeSql, makeWorkspace, resetDb } from "../helpers/db";
import { sql } from "@/lib/db";
import * as D from "@/lib/server/docs";
import * as T from "@/lib/server/training";
import { TEMPLATES } from "@/lib/docs-templates";

beforeAll(async () => { await resetDb(); });
afterAll(closeSql);

describe("documentation", () => {
  it("starts from templates that contain no invented results", async () => {
    for (const t of TEMPLATES) expect(t.body).not.toMatch(/\b\d{2,3}(\.\d)?\s?%/); // no made-up scores
    const w = await makeWorkspace();
    const { id } = await D.createDoc(w.actor(), { kind: "model_card" });
    const d = await D.getDoc(w.id, id);
    expect(d.title).toBe("Model card"); expect(d.body).toContain("## Limitations"); expect(d.version).toBe(1);
  });
  it("uses optimistic concurrency", async () => {
    const w = await makeWorkspace(); const a = w.actor();
    const { id } = await D.createDoc(a, { title: "Notes", kind: "blank" });
    const r = await D.updateDoc(a, id, { version: 1, body: "hello" });
    expect(r.version).toBe(2);
    await expect(D.updateDoc(a, id, { version: 1, body: "stale" })).rejects.toMatchObject({ status: 409 });
    expect((await D.getDoc(w.id, id)).body).toBe("hello");
  });
  it("links only real items from the same workspace and resolves them", async () => {
    const w = await makeWorkspace(), o = await makeWorkspace();
    const [ds] = await sql()`insert into datasets (workspace_id, name, task_type) values (${w.id}, 'Belt', 'detect') returning id`;
    const [ods] = await sql()`insert into datasets (workspace_id, name, task_type) values (${o.id}, 'Secret', 'detect') returning id`;
    const { id } = await D.createDoc(w.actor(), { title: "L" });
    await D.updateDoc(w.actor(), id, { version: 1, links: [{ type: "dataset", id: ds.id }] });
    expect((await D.getDoc(w.id, id)).links).toEqual([expect.objectContaining({ type: "dataset", title: "Belt" })]);
    await expect(D.updateDoc(w.actor(), id, { version: 2, links: [{ type: "dataset", id: ods.id }] })).rejects.toMatchObject({ status: 400 });
  });
  it("searches titles and bodies, archives instead of deleting, and isolates workspaces", async () => {
    const w = await makeWorkspace(), o = await makeWorkspace(); const a = w.actor();
    const { id } = await D.createDoc(a, { title: "Lighting setup", body: "Use a 5000K diffuse lamp." });
    await D.createDoc(a, { title: "Other", body: "nothing" });
    expect((await D.listDocs(w.id, "diffuse")).map((d) => d.title)).toEqual(["Lighting setup"]);
    expect((await D.listDocs(w.id, "%")).length).toBe(0); // wildcard characters are literal
    await expect(D.getDoc(o.id, id)).rejects.toMatchObject({ status: 404 });
    expect((await D.listDocs(o.id)).length).toBe(0);
    await D.archiveDoc(a, id);
    expect((await D.listDocs(w.id, "diffuse")).length).toBe(0);
    const [row] = await sql()`select archived_at from docs where id = ${id}`;
    expect(row.archived_at).not.toBeNull(); // kept, not deleted
  });
  it("run snapshots carry real, split-labelled numbers and say 'not evaluated' otherwise", async () => {
    const w = await makeWorkspace();
    const [d] = await sql()`insert into datasets (workspace_id, name, task_type) values (${w.id}, 'D', 'detect') returning id`;
    const [v] = await sql()`insert into dataset_versions (dataset_id, number, name, seed, ratios, classes, counts) values (${d.id}, 1, 'v1', 1, ${sql().json({})}, ${sql().json([])}, ${sql().json({ train: 5, val: 2, test: 1 })}) returning id`;
    const r = await T.createRun(w.actor(), T.runConfigSchema.parse({ versionId: v.id, arch: "yolov8n" }));
    let s = (await D.runSnapshot(w.id, r.id)).markdown;
    expect(s).toContain("not evaluated yet"); expect(s).not.toMatch(/%/);
    await sql()`update training_runs set status = 'completed', best_metrics = ${sql().json({ epoch: 3, "metrics/mAP50(B)": 0.5 })} where id = ${r.id}`;
    await sql()`insert into evaluations (workspace_id, run_id, split, status, metrics, n_images) values (${w.id}, ${r.id}, 'test', 'completed', ${sql().json({ map50: 0.25, precision: 0.3, recall: 0.2, map5095: 0.1 })}, 40)`;
    s = (await D.runSnapshot(w.id, r.id)).markdown;
    expect(s).toContain("validation (best epoch 3, used for training)"); expect(s).toContain("test (evaluated) | 40 | 30.0% | 20.0% | 25.0%");
    expect(s).not.toContain("not evaluated yet");
    const o = await makeWorkspace();
    await expect(D.runSnapshot(o.id, r.id)).rejects.toMatchObject({ status: 404 });
  });
});
