import { beforeAll, afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { addMember, closeSql, makeWorkspace, resetDb } from "../helpers/db";
import * as ds from "@/lib/server/datasets";
import { ingestImage, inspectImage, MAX_UPLOAD_BYTES } from "@/lib/server/ingest";
import * as an from "@/lib/server/annotations";
import { qualityReport, nearDuplicateGroups } from "@/lib/server/quality";
import { assignSplits, createVersion } from "@/lib/server/versions";
import { resetStorageForTests } from "@/lib/storage";

process.env.STORAGE_DRIVER = "local";
process.env.LOCAL_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "wv-test-"));
beforeAll(async () => { resetStorageForTests(); await resetDb(); });
afterAll(closeSql);

let seed = 0;
async function png(opts: { color?: [number, number, number]; size?: number; noise?: boolean } = {}) {
  seed++;
  const size = opts.size ?? 64;
  const raw = Buffer.alloc(size * size * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = opts.noise === false ? (opts.color?.[i % 3] ?? 128) : ((i * 7 + seed * 53 + (i % 13) * seed) & 255);
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}
async function setup(taskType: ds.TaskType = "detect") {
  const w = await makeWorkspace();
  const a = w.actor();
  const id = await ds.createDataset(a, { name: "Belt " + seed++, taskType });
  return { w, a, id };
}

describe("ingestion", () => {
  it("accepts real images, stores originals + thumbnails and records quality", async () => {
    const { a, id } = await setup();
    const r = await ingestImage(a, id, "a.png", await png());
    expect(r.status).toBe("added");
    const stats = await ds.datasetStats(id);
    expect(stats.total).toBe(1);
    const page = await ds.browseImages(id, {});
    expect(page.items[0].thumbUrl).toMatch(/^\/api\/files\/w\//);
  });
  it("rejects duplicates, non-images, empty and oversize files without crashing", async () => {
    const { a, id } = await setup();
    const img = await png();
    expect((await ingestImage(a, id, "a.png", img)).status).toBe("added");
    expect((await ingestImage(a, id, "copy.png", img)).status).toBe("duplicate");
    expect((await ingestImage(a, id, "x.png", Buffer.from("not an image"))).status).toBe("rejected");
    expect((await ingestImage(a, id, "e.png", Buffer.alloc(0))).status).toBe("rejected");
    const big = Buffer.concat([img, Buffer.alloc(MAX_UPLOAD_BYTES)]);
    expect((await ingestImage(a, id, "big.png", big)).message).toMatch(/Larger than/);
    expect((await ds.datasetStats(id)).total).toBe(1);
  });
  it("only roles with edit permission can upload; no cross-workspace uploads", async () => {
    const { w, a, id } = await setup();
    const m = await addMember(w.id, "member");
    await expect(ingestImage(w.actor(m.id, "member"), id, "a.png", await png())).rejects.toMatchObject({ code: "forbidden" });
    const other = await makeWorkspace();
    await expect(ingestImage(other.actor(), id, "a.png", await png())).rejects.toMatchObject({ code: "not_found" });
    expect(a).toBeTruthy();
  });
  it("sniffs content, not the extension", async () => {
    await expect(inspectImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).rejects.toThrow(/Only JPEG|readable/);
    const i = await inspectImage(await png({ size: 100 }));
    expect([i.width, i.height]).toEqual([100, 100]);
    expect(i.dhash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("annotation", () => {
  async function labeled() {
    const { w, a, id } = await setup();
    const r = await ingestImage(a, id, "a.png", await png());
    return { w, a, id, img: r.id! };
  }
  it("saves boxes, clips to the image, and bumps the version", async () => {
    const { a, id, img } = await labeled();
    const res = await an.saveAnnotation(a, id, img, { version: 1, boxes: [{ classIndex: 0, cx: 0.95, cy: 0.5, w: 0.3, h: 0.2 }] });
    expect(res.status).toBe("labeled");
    const got = await an.getAnnotation(a, id, img);
    expect(got.boxes).toHaveLength(1);
    expect(got.boxes[0].cx + got.boxes[0].w / 2).toBeLessThanOrEqual(1.0001);
    expect(got.image.version).toBe(2);
  });
  it("rejects bad boxes, unknown classes and stale versions", async () => {
    const { a, id, img } = await labeled();
    await expect(an.saveAnnotation(a, id, img, { version: 1, boxes: [{ classIndex: 99, cx: .5, cy: .5, w: .2, h: .2 }] })).rejects.toMatchObject({ message: /doesn't exist/ });
    await expect(an.saveAnnotation(a, id, img, { version: 1, boxes: [{ classIndex: 0, cx: 1.5, cy: .5, w: .1, h: .1 }] })).rejects.toMatchObject({ message: /outside/ });
    await expect(an.saveAnnotation(a, id, img, { version: 1, boxes: [{ classIndex: 0, cx: .5, cy: .5, w: NaN, h: .1 }] })).rejects.toBeTruthy();
    await an.saveAnnotation(a, id, img, { version: 1, isBackground: true });
    await expect(an.saveAnnotation(a, id, img, { version: 1, isBackground: true })).rejects.toMatchObject({ code: "conflict" });
    await expect(an.saveAnnotation(a, id, img, { version: 2, isBackground: true, boxes: [{ classIndex: 0, cx: .5, cy: .5, w: .2, h: .2 }] })).rejects.toMatchObject({ message: /both/ });
  });
  it("classification stores one class per image and no boxes", async () => {
    const { a, id } = await setup("classify");
    const r = await ingestImage(a, id, "c.png", await png());
    await an.saveAnnotation(a, id, r.id!, { version: 1, classIndex: 2 });
    const g = await an.getAnnotation(a, id, r.id!);
    expect(g.image.classIndex).toBe(2); expect(g.boxes).toHaveLength(0);
    await expect(an.saveAnnotation(a, id, r.id!, { version: 2, classIndex: 77 })).rejects.toMatchObject({ message: /Unknown class/ });
  });
  it("annotators can label but not review; reviewers can't approve their own work; fixes need a note", async () => {
    const { w, id, img } = await labeled();
    const annot = await addMember(w.id, "annotator"), eng = await addMember(w.id, "ml_engineer"), eng2 = await addMember(w.id, "ml_engineer");
    await an.saveAnnotation(w.actor(annot.id, "annotator"), id, img, { version: 1, boxes: [{ classIndex: 1, cx: .5, cy: .5, w: .2, h: .2 }] });
    await expect(an.reviewImage(w.actor(annot.id, "annotator"), id, img, { decision: "approve" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(an.reviewImage(w.actor(eng.id, "ml_engineer"), id, img, { decision: "needs_fixes" })).rejects.toMatchObject({ message: /what needs fixing/ });
    await an.reviewImage(w.actor(eng.id, "ml_engineer"), id, img, { decision: "needs_fixes", note: "box too loose" });
    expect((await an.getAnnotation(w.actor(), id, img)).image.reviewNote).toBe("box too loose");
    await an.saveAnnotation(w.actor(eng.id, "ml_engineer"), id, img, { version: 2, boxes: [{ classIndex: 1, cx: .5, cy: .5, w: .2, h: .2 }] });
    await expect(an.reviewImage(w.actor(eng.id, "ml_engineer"), id, img, { decision: "approve" })).rejects.toMatchObject({ message: /another reviewer/ });
    await an.reviewImage(w.actor(eng2.id, "ml_engineer"), id, img, { decision: "approve" });
    expect((await ds.datasetStats(id)).approved).toBe(1);
    await an.saveAnnotation(w.actor(annot.id, "annotator"), id, img, { version: 3, boxes: [] }); // editing resets approval
    expect((await ds.datasetStats(id)).approved).toBe(0);
  });
  it("cannot read or save an image of another workspace's dataset", async () => {
    const { id, img } = await labeled();
    const other = await makeWorkspace();
    await expect(an.getAnnotation(other.actor(), id, img)).rejects.toMatchObject({ code: "not_found" });
    await expect(an.saveAnnotation(other.actor(), id, img, { version: 1, isBackground: true })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("classes", () => {
  it("are append-only so stored indexes never shift", async () => {
    const { a, id } = await setup();
    await ds.addClass(a, id, "glass");
    await expect(ds.addClass(a, id, "GLASS")).rejects.toMatchObject({ message: /already exists/ });
    const cls = await ds.listClasses(id);
    expect(cls.map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5]);
    await ds.updateClass(a, id, 5, { name: "glass_bottle", guideline: "Whole bottles only" });
    expect((await ds.listClasses(id))[5].name).toBe("glass_bottle");
  });
});

describe("quality report", () => {
  it("flags unlabeled, thin classes and near-duplicates from real data", async () => {
    const { a, id } = await setup();
    const base = await png({ size: 128 });
    await ingestImage(a, id, "orig.png", base);
    const tweaked = await sharp(base).modulate({ brightness: 1.02 }).png().toBuffer();
    await ingestImage(a, id, "near.png", tweaked);
    await ingestImage(a, id, "other.png", await png({ size: 128 }));
    const wsId = a.workspaceId;
    const rep = await qualityReport(wsId, id);
    const codes = rep.issues.map((i) => i.code);
    expect(codes).toContain("unlabeled");
    expect(codes).toContain("few_examples");
    expect(rep.distribution.length).toBe(5);
  });
  it("groups near duplicates by Hamming distance", () => {
    const g = nearDuplicateGroups([{ id: "a", dhash: "0000000000000000" }, { id: "b", dhash: "0000000000000003" }, { id: "c", dhash: "ffffffffffffffff" }]);
    expect(g).toEqual([["a", "b"]]);
  });
});

describe("versions & splits", () => {
  async function approved(n: number) {
    const { w, a, id } = await setup();
    const rev = await addMember(w.id, "ml_engineer");
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const r = await ingestImage(a, id, `i${i}.png`, await png({ size: 48 + i }));
      await an.saveAnnotation(a, id, r.id!, { version: 1, boxes: [{ classIndex: i % 2, cx: .5, cy: .5, w: .3, h: .3 }] });
      await an.reviewImage(w.actor(rev.id, "ml_engineer"), id, r.id!, { decision: "approve" });
      ids.push(r.id!);
    }
    return { w, a, id, ids };
  }
  it("needs enough approved images", async () => {
    const { a, id } = await setup();
    await expect(createVersion(a, id, {})).rejects.toMatchObject({ message: /at least 3/ });
  });
  it("freezes labels, splits 70/20/10 deterministically and never changes after later edits", async () => {
    const { a, id, ids } = await approved(10);
    const v1 = await createVersion(a, id, { seed: 7 });
    expect(v1.counts).toMatchObject({ total: 10, train: 7, val: 2, test: 1 });
    const { sql } = await import("@/lib/db");
    const before = await sql()`select image_id, split from version_images where version_id = ${v1.id} order by image_id`;
    await an.saveAnnotation(a, id, ids[0], { version: 2, boxes: [{ classIndex: 0, cx: .2, cy: .2, w: .1, h: .1 }] });
    const after = await sql()`select image_id, split, boxes from version_images where version_id = ${v1.id} order by image_id`;
    expect(after.map((r) => [r.image_id, r.split])).toEqual(before.map((r) => [r.image_id, r.split]));
    const frozen = after.find((r) => r.image_id === ids[0])!.boxes as { cx: number }[];
    expect(frozen[0].cx).toBe(0.5); // the snapshot kept the old label
  });
  it("keeps earlier test images in test (holdout is never trained on)", async () => {
    const { a, id } = await approved(12);
    const { sql } = await import("@/lib/db");
    const v1 = await createVersion(a, id, { seed: 1 });
    const test1 = (await sql()`select image_id from version_images where version_id = ${v1.id} and split = 'test'`).map((r) => r.image_id);
    const v2 = await createVersion(a, id, { seed: 999 });
    const split2 = new Map((await sql()`select image_id, split from version_images where version_id = ${v2.id}`).map((r) => [r.image_id, r.split]));
    for (const t of test1) expect(split2.get(t)).toBe("test");
  });
  it("is reproducible: same seed, same split", () => {
    const imgs = Array.from({ length: 30 }, (_, i) => ({ id: "id" + i, sha256: "sha" + i }));
    const a = assignSplits(imgs, [], { train: .7, val: .2, test: .1 }, 5, new Set());
    const b = assignSplits(imgs, [], { train: .7, val: .2, test: .1 }, 5, new Set());
    expect([...a]).toEqual([...b]);
    const c = assignSplits(imgs, [], { train: .7, val: .2, test: .1 }, 6, new Set());
    expect([...c]).not.toEqual([...a]);
  });
  it("never splits a near-duplicate group across train/val/test", () => {
    const imgs = Array.from({ length: 40 }, (_, i) => ({ id: "id" + i, sha256: "sha" + i }));
    const groups = [["id0", "id1", "id2", "id3"], ["id10", "id11"]];
    for (let seed = 0; seed < 20; seed++) {
      const s = assignSplits(imgs, groups, { train: .7, val: .2, test: .1 }, seed, new Set());
      for (const g of groups) expect(new Set(g.map((id) => s.get(id))).size).toBe(1);
    }
  });
  it("rejects ratios that don't add up", async () => {
    const { a, id } = await approved(5);
    await expect(createVersion(a, id, { ratios: { train: .5, val: .2, test: .1 } })).rejects.toMatchObject({ message: /add up/ });
  });
});
