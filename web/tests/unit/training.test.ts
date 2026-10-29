import { beforeAll, afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { addMember, closeSql, makeWorkspace, resetDb } from "../helpers/db";
import { sql } from "@/lib/db";
import * as T from "@/lib/server/training";
import { resetStorageForTests } from "@/lib/storage";

process.env.STORAGE_DRIVER = "local";
process.env.LOCAL_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "wv-test-"));
beforeAll(async () => { resetStorageForTests(); await resetDb(); });
afterAll(closeSql);

async function withVersion(counts = { train: 7, val: 2, test: 1 }, task: "detect" | "classify" = "detect") {
  const w = await makeWorkspace();
  const [d] = await sql()`insert into datasets (workspace_id, name, task_type) values (${w.id}, 'D', ${task}) returning id`;
  const [v] = await sql()`insert into dataset_versions (dataset_id, number, name, seed, ratios, classes, counts) values (${d.id}, 1, 'v1', 1, ${sql().json({})}, ${sql().json([{ index: 0, name: "a" }])}, ${sql().json(counts)}) returning id`;
  return { w, versionId: v.id as string, a: w.actor() };
}
const cfg = (versionId: string, extra = {}) => T.runConfigSchema.parse({ versionId, arch: "yolov8n", epochs: 5, imgsz: 320, batch: 8, ...extra });

describe("training runs", () => {
  it("queues a run + a worker job together, numbering runs per workspace", async () => {
    const { a, versionId } = await withVersion();
    const r = await T.createRun(a, cfg(versionId));
    expect(r.number).toBe(1);
    const run = await T.getRun(a.workspaceId, r.id);
    expect(run.status).toBe("queued");
    expect(run.jobId).toBe(r.jobId);
    expect(run.epochsDone).toBe(0);
    expect(run.bestMetrics).toBeNull(); // no invented numbers
    const [j] = await sql()`select kind, params, status from worker_jobs where id = ${r.jobId}`;
    expect(j.kind).toBe("train"); expect(j.status).toBe("queued"); expect(j.params.runId).toBe(r.id);
  });
  it("rejects double submits, wrong-task models, unsplit versions and lowly roles", async () => {
    const { w, a, versionId } = await withVersion();
    await T.createRun(a, cfg(versionId, { seed: 3 }));
    await expect(T.createRun(a, cfg(versionId, { seed: 3 }))).rejects.toMatchObject({ status: 409 });
    await expect(T.createRun(a, cfg(versionId, { arch: "yolov8n-cls" }))).rejects.toMatchObject({ status: 400 });
    const empty = await withVersion({ train: 3, val: 0, test: 0 });
    await expect(T.createRun(empty.a, cfg(empty.versionId))).rejects.toThrow(/validation/);
    const annot = await addMember(w.id, "annotator");
    await expect(T.createRun({ ...a, id: annot.id, role: "annotator" }, cfg(versionId, { seed: 9 }))).rejects.toMatchObject({ status: 403 });
    expect(() => cfg(versionId, { imgsz: 100 })).toThrow(/multiple of 32/);
    expect(() => cfg(versionId, { epochs: 0 })).toThrow();
  });
  it("is isolated between workspaces", async () => {
    const x = await withVersion(), y = await withVersion();
    const r = await T.createRun(x.a, cfg(x.versionId));
    await expect(T.getRun(y.a.workspaceId, r.id)).rejects.toMatchObject({ status: 404 });
    await expect(T.createRun(y.a, cfg(x.versionId))).rejects.toMatchObject({ status: 404 });
    await expect(T.cancelJob(y.a, r.jobId)).rejects.toMatchObject({ status: 404 });
    expect((await T.listRuns(y.a.workspaceId)).length).toBe(0);
    await expect(T.getJob(y.a.workspaceId, r.jobId)).rejects.toMatchObject({ status: 404 });
  });
  it("cancels queued jobs immediately and flags running ones", async () => {
    const { a, versionId } = await withVersion();
    const r = await T.createRun(a, cfg(versionId));
    await T.cancelRun(a, r.id);
    expect((await T.getRun(a.workspaceId, r.id)).status).toBe("cancelled");
    const r2 = await T.createRun(a, cfg(versionId, { seed: 77 }));
    await sql()`update worker_jobs set status = 'running', heartbeat_at = now() where id = ${r2.jobId}`;
    await sql()`update training_runs set status = 'running' where id = ${r2.id}`;
    await T.cancelRun(a, r2.id);
    const [j] = await sql()`select cancel_requested, status from worker_jobs where id = ${r2.jobId}`;
    expect(j.cancel_requested).toBe(true); expect(j.status).toBe("running");
  });
  it("marks silent running jobs as interrupted, never completed, and allows retry", async () => {
    const { a, versionId } = await withVersion();
    const r = await T.createRun(a, cfg(versionId, { seed: 5 }));
    await sql()`update worker_jobs set status = 'running', heartbeat_at = now() - interval '10 minutes' where id = ${r.jobId}`;
    await sql()`update training_runs set status = 'running' where id = ${r.id}`;
    const run = await T.getRun(a.workspaceId, r.id);
    expect(run.status).toBe("interrupted");
    await expect(T.retryRun(a, r.id)).rejects.toMatchObject({ status: 409 }); // double-click guard
    await sql()`update training_runs set created_at = now() - interval '1 minute' where id = ${r.id}`;
    const retry = await T.retryRun(a, r.id);
    expect(retry.number).toBe(r.number + 1);
  });
  it("only evaluates finished runs, one open evaluation per split", async () => {
    const { a, versionId } = await withVersion();
    const r = await T.createRun(a, cfg(versionId));
    await expect(T.startEvaluation(a, r.id, "test")).rejects.toThrow(/after training/);
    await sql()`update training_runs set status = 'completed', artifacts = ${sql().json({ best: { key: `w/${a.workspaceId}/runs/${r.id}/best.pt`, bytes: 1, sha256: "x" } })} where id = ${r.id}`;
    const e = await T.startEvaluation(a, r.id, "test");
    await expect(T.startEvaluation(a, r.id, "test")).rejects.toMatchObject({ status: 409 });
    await expect(T.startEvaluation(a, r.id, "val")).resolves.toBeTruthy();
    expect((await T.getEvaluation(a.workspaceId, e.id)).metrics).toBeNull();
  });
  it("accepts a real image for prediction and rejects junk and oversize files", async () => {
    const { a, versionId } = await withVersion();
    const r = await T.createRun(a, cfg(versionId));
    await sql()`update training_runs set status = 'completed', artifacts = ${sql().json({ best: { key: "w/x/best.pt", bytes: 1, sha256: "x" } })} where id = ${r.id}`;
    const img = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#888" } }).png().toBuffer();
    const p = await T.createPrediction(a, r.id, { name: "a.png", data: img }, 0.25, 0.7);
    expect((await T.getPrediction(a.workspaceId, p.id)).status).toBe("queued");
    await expect(T.createPrediction(a, r.id, { name: "a.png", data: Buffer.from("nope") }, 0.25, 0.7)).rejects.toMatchObject({ status: 400 });
    await expect(T.createPrediction(a, r.id, { name: "a.png", data: img }, 5, 0.7)).rejects.toMatchObject({ status: 400 });
    await expect(T.createPrediction(a, r.id, { name: "a.mp4", data: Buffer.alloc(5 * 1024 * 1024) }, 0.25, 0.7)).rejects.toThrow(/4 MB/);
  });
});
