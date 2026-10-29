import { createHash } from "node:crypto";
import sharp from "sharp";
import { sql } from "../db";
import { badRequest, forbidden } from "../errors";
import { can } from "../authz";
import { imageKey, storage, thumbKey } from "../storage";
import { datasetFor, type Actor } from "./datasets";
import { log } from "./activity";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel request bodies are limited to 4.5 MB
const FORMATS: Record<string, { ext: string; type: string }> = { jpeg: { ext: "jpg", type: "image/jpeg" }, png: { ext: "png", type: "image/png" }, webp: { ext: "webp", type: "image/webp" } };

/** 64-bit difference hash (hex). Computed here for every upload so near-duplicate checks compare like with like. */
async function dhash(buf: Buffer): Promise<string> {
  const px = await sharp(buf).rotate().greyscale().resize(9, 8, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
  return bits.toString(16).padStart(16, "0");
}

export type Inspected = { format: string; ext: string; type: string; width: number; height: number; sha256: string; brightness: number; blur: number; dhash: string; thumb: Buffer };

export async function inspectImage(buf: Buffer): Promise<Inspected> {
  if (buf.length === 0) throw badRequest("The file is empty.");
  if (buf.length > MAX_UPLOAD_BYTES) throw badRequest(`Larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB. Resize it, or use a smaller export.`);
  let meta;
  try { meta = await sharp(buf, { limitInputPixels: 100_000_000 }).metadata(); } catch { throw badRequest("Not a readable image."); }
  const f = meta.format ? FORMATS[meta.format] : undefined;
  if (!f || !meta.width || !meta.height) throw badRequest("Only JPEG, PNG and WebP images are supported.");
  const oriented = (meta.orientation ?? 1) >= 5; // EXIF rotation swaps width/height
  const width = oriented ? meta.height : meta.width, height = oriented ? meta.width : meta.height;
  const small = await sharp(buf).rotate().greyscale().resize(256, 256, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  const { data, info } = small;
  let sum = 0; for (const v of data) sum += v;
  const brightness = sum / data.length;
  // variance of the 4-neighbour Laplacian: low ⇒ blurry
  let n = 0, mean = 0, m2 = 0;
  for (let y = 1; y < info.height - 1; y++) for (let x = 1; x < info.width - 1; x++) {
    const i = y * info.width + x;
    const l = data[i - 1] + data[i + 1] + data[i - info.width] + data[i + info.width] - 4 * data[i];
    n++; const d = l - mean; mean += d / n; m2 += d * (l - mean);
  }
  const blur = n > 1 ? m2 / (n - 1) : 0;
  const thumb = await sharp(buf).rotate().resize(256, 256, { fit: "inside" }).jpeg({ quality: 78 }).toBuffer();
  return { format: meta.format!, ext: f.ext, type: f.type, width, height, sha256: createHash("sha256").update(buf).digest("hex"), brightness, blur, dhash: await dhash(buf), thumb };
}

export type UploadResult = { filename: string; status: "added" | "duplicate" | "rejected"; message?: string; id?: string };

export async function ingestImage(a: Actor, datasetId: string, filename: string, buf: Buffer): Promise<UploadResult> {
  if (!can(a.role, "datasets.edit")) throw forbidden();
  await datasetFor(a.workspaceId, datasetId);
  const name = filename.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "image";
  let info: Inspected;
  try { info = await inspectImage(buf); } catch (e) { return { filename: name, status: "rejected", message: (e as Error).message }; }
  const [dup] = await sql()`select filename from dataset_images where dataset_id = ${datasetId} and sha256 = ${info.sha256}`;
  if (dup) return { filename: name, status: "duplicate", message: `Identical to ${dup.filename}` };
  const key = imageKey(a.workspaceId, datasetId, info.sha256, info.ext), tkey = thumbKey(a.workspaceId, datasetId, info.sha256);
  await storage().put(key, buf, info.type);
  await storage().put(tkey, info.thumb, "image/jpeg");
  const [r] = await sql()`insert into dataset_images (dataset_id, filename, storage_key, thumb_key, sha256, dhash, width, height, bytes, brightness, blur, uploaded_by)
    values (${datasetId}, ${name}, ${key}, ${tkey}, ${info.sha256}, ${info.dhash}, ${info.width}, ${info.height}, ${buf.length}, ${info.brightness}, ${info.blur}, ${a.id})
    on conflict (dataset_id, sha256) do nothing returning id`;
  if (!r) return { filename: name, status: "duplicate", message: "Already uploaded" };
  return { filename: name, status: "added", id: r.id as string };
}

export async function logUploadBatch(a: Actor, datasetId: string, results: UploadResult[]) {
  const added = results.filter((r) => r.status === "added").length;
  if (added) await log(sql(), a.workspaceId, a.id, "dataset.images_added", "dataset", datasetId, `Uploaded ${added} image${added > 1 ? "s" : ""}`);
}
