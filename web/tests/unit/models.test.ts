import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { addMember, closeSql, makeWorkspace, resetDb } from "../helpers/db";
import { sql } from "@/lib/db";
import * as T from "@/lib/server/training";
import * as M from "@/lib/server/models";

beforeAll(async () => { await resetDb(); });
afterAll(closeSql);

async function completedRun(w: Awaited<ReturnType<typeof makeWorkspace>>, task: "detect" | "classify" = "detect", versionId?: string) {
  let vid = versionId;
  if (!vid) {
    const [d] = await sql()`insert into datasets (workspace_id, name, task_type) values (${w.id}, ${"D" + Math.random()}, ${task}) returning id`;
    const [v] = await sql()`insert into dataset_versions (dataset_id, number, name, seed, ratios, classes, counts) values (${d.id}, 1, 'v1', 1, ${sql().json({})}, ${sql().json([])}, ${sql().json({ train: 5, val: 2, test: 1 })}) returning id`;
    vid = v.id as string;
  }
  const arch = task === "detect" ? "yolov8n" : "yolov8n-cls";
  const r = await T.createRun(w.actor(), T.runConfigSchema.parse({ versionId: vid, arch, seed: Math.floor(Math.random() * 1e6) }));
  await sql()`update training_runs set status = 'completed', best_metrics = ${sql().json({ split: "val", epoch: 2, "metrics/mAP50(B)": 0.4 })}, config = config || ${sql().json({ class_names: { 0: "plastic", 1: "metal" } })},
    artifacts = ${sql().json({ best: { key: `w/${w.id}/runs/${r.id}/best.pt`, bytes: 123, sha256: "abc" } })} where id = ${r.id}`;
  return { id: r.id, versionId: vid };
}

describe("model registry", () => {
  it("creates immutable, numbered versions per name and never overwrites", async () => {
    const w = await makeWorkspace(); const a = w.actor();
    const r1 = await completedRun(w), r2 = await completedRun(w);
    const m1 = await M.registerModel(a, { runId: r1.id, name: "waste-detector", notes: "" });
    const m2 = await M.registerModel(a, { runId: r2.id, name: "Waste-Detector", notes: "second" });
    expect([m1.number, m2.number]).toEqual([1, 2]);
    expect(m2.name).toBe("waste-detector");
    await expect(M.registerModel(a, { runId: r1.id, name: "waste-detector", notes: "" })).rejects.toMatchObject({ status: 409 });
    const got = await M.getModel(w.id, m1.id);
    expect(got.classes).toEqual(["plastic", "metal"]);
    expect(got.testMetrics).toBeNull(); // no invented numbers
  });
  it("needs confirmation before replacing the selected version", async () => {
    const w = await makeWorkspace(); const a = w.actor();
    const [r1, r2] = [await completedRun(w), await completedRun(w)];
    const m1 = await M.registerModel(a, { runId: r1.id, name: "m", notes: "" });
    const m2 = await M.registerModel(a, { runId: r2.id, name: "m", notes: "" });
    await M.updateModel(a, m1.id, { stage: "selected" });
    await expect(M.updateModel(a, m2.id, { stage: "selected" })).rejects.toMatchObject({ status: 409, extra: { needsConfirm: true } });
    await M.updateModel(a, m2.id, { stage: "selected", confirmReplace: true });
    expect((await M.getModel(w.id, m1.id)).stage).toBe("candidate");
    expect((await M.getModel(w.id, m2.id)).stage).toBe("selected");
  });
  it("enforces roles, run state and workspace isolation", async () => {
    const w = await makeWorkspace(); const a = w.actor();
    const r = await completedRun(w);
    const member = await addMember(w.id, "member");
    await expect(M.registerModel({ ...a, id: member.id, role: "member" }, { runId: r.id, name: "x1", notes: "" })).rejects.toMatchObject({ status: 403 });
    const [d] = await sql()`select dataset_id from training_runs where id = ${r.id}`;
    const queued = await T.createRun(a, T.runConfigSchema.parse({ versionId: r.versionId, arch: "yolov8n", seed: 424242 }));
    void d;
    await expect(M.registerModel(a, { runId: queued.id, name: "x1", notes: "" })).rejects.toMatchObject({ status: 400 });
    const m = await M.registerModel(a, { runId: r.id, name: "x1", notes: "" });
    const other = await makeWorkspace();
    await expect(M.getModel(other.id, m.id)).rejects.toMatchObject({ status: 404 });
    await expect(M.modelDownload(other.id, m.id)).rejects.toMatchObject({ status: 404 });
    await expect(M.registerModel(other.actor(), { runId: r.id, name: "x1", notes: "" })).rejects.toMatchObject({ status: 404 });
    expect((await M.listModels(other.id)).length).toBe(0);
  });
  it("compares only like with like", async () => {
    const w = await makeWorkspace();
    const a = await completedRun(w), b = await completedRun(w), c = await completedRun(w, "classify");
    await expect(M.compareRuns(w.id, [a.id])).rejects.toMatchObject({ status: 400 });
    await expect(M.compareRuns(w.id, [a.id, c.id])).rejects.toThrow(/can't be compared/);
    const cmp = await M.compareRuns(w.id, [a.id, b.id]);
    expect(cmp.sameDataVersion).toBe(false); // separate datasets: the UI must warn
    expect(cmp.runs.every((r) => r.test === null)).toBe(true); // never fabricate a test score
    const same = await completedRun(w, "detect", a.versionId);
    expect((await M.compareRuns(w.id, [a.id, same.id])).sameDataVersion).toBe(true);
    const other = await makeWorkspace();
    await expect(M.compareRuns(other.id, [a.id, b.id])).rejects.toMatchObject({ status: 404 });
  });
});
