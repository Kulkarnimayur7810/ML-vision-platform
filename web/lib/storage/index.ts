import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface Store {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  del(key: string): Promise<void>;
  /** Short-lived URL for the browser. */
  url(key: string, seconds?: number): Promise<string>;
}

/** Keys use the same layout the Python worker writes, so both sides agree. */
export const imageKey = (ws: string, ds: string, sha: string, ext: string) => `w/${ws}/d/${ds}/images/${sha.slice(0, 2)}/${sha}.${ext}`;
export const thumbKey = (ws: string, ds: string, sha: string) => `w/${ws}/d/${ds}/thumbs/${sha.slice(0, 2)}/${sha}_256.jpg`;
export function assertKey(key: string) {
  if (!/^[A-Za-z0-9/_.\-]+$/.test(key) || key.includes("..") || key.startsWith("/")) throw new Error("Invalid storage key");
}

const secret = () => process.env.APP_SECRET ?? "dev-secret";
export function signLocal(key: string, expires: number) { return createHmac("sha256", secret()).update(`${key}\n${expires}`).digest("hex"); }
export function verifyLocal(key: string, expires: number, sig: string) {
  if (!Number.isFinite(expires) || expires < Date.now() / 1000) return false;
  const a = Buffer.from(signLocal(key, expires)), b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

class LocalStore implements Store {
  constructor(private root: string) {}
  private p(key: string) { assertKey(key); return path.join(this.root, key); }
  async put(key: string, body: Buffer) { const f = this.p(key); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, body); }
  async get(key: string) { return fs.readFile(this.p(key)); }
  async del(key: string) { await fs.rm(this.p(key), { force: true }); }
  async url(key: string, seconds = 300) {
    assertKey(key);
    const exp = Math.floor(Date.now() / 1000) + seconds;
    return `/api/files/${key}?e=${exp}&s=${signLocal(key, exp)}`;
  }
}

class S3Store implements Store {
  private c: S3Client; private bucket: string;
  constructor() {
    const e = process.env;
    if (!e.S3_BUCKET || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY) throw new Error("S3 storage is not configured (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)");
    this.bucket = e.S3_BUCKET;
    this.c = new S3Client({ region: e.S3_REGION || "auto", endpoint: e.S3_ENDPOINT || undefined, forcePathStyle: e.S3_FORCE_PATH_STYLE !== "0", credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY } });
  }
  async put(key: string, body: Buffer, contentType: string) { assertKey(key); await this.c.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType })); }
  async get(key: string) { assertKey(key); const r = await this.c.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })); return Buffer.from(await r.Body!.transformToByteArray()); }
  async del(key: string) { assertKey(key); await this.c.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })); }
  async url(key: string, seconds = 300) { assertKey(key); return getSignedUrl(this.c, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: seconds }); }
}

let cached: Store | null = null;
export function storage(): Store {
  if (cached) return cached;
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver === "s3") cached = new S3Store();
  else if (driver === "local") {
    if (process.env.NODE_ENV === "production" && process.env.VERCEL) throw new Error("Local storage can't be used on Vercel (the disk is not persistent). Set STORAGE_DRIVER=s3.");
    cached = new LocalStore(process.env.LOCAL_STORAGE_DIR ?? path.join(process.cwd(), ".local-storage"));
  } else throw new Error(`Unknown STORAGE_DRIVER "${driver}"`);
  return cached;
}
export function resetStorageForTests() { cached = null; }
