import { describe, expect, it } from "vitest";
import { resetStorageForTests, storage } from "@/lib/storage";

// Runs only when an S3-compatible endpoint is provided (CI/dev: a moto or MinIO server). Skipped otherwise, never faked.
const ep = process.env.TEST_S3_ENDPOINT;
describe.skipIf(!ep)("S3 storage driver against a real S3 API", () => {
  it("puts, gets, signs a URL that downloads, and deletes", async () => {
    Object.assign(process.env, { STORAGE_DRIVER: "s3", S3_ENDPOINT: ep, S3_BUCKET: "wv-test", S3_REGION: "us-east-1", S3_ACCESS_KEY_ID: "test", S3_SECRET_ACCESS_KEY: "test" });
    resetStorageForTests();
    const s = storage();
    const key = `w/ws1/runs/r1/best-${Date.now()}.pt`;
    await s.put(key, Buffer.from("hello-bytes"), "application/octet-stream");
    expect((await s.get(key)).toString()).toBe("hello-bytes");
    const url = await s.url(key, 60);
    expect(url).toContain(key);
    const res = await fetch(url);
    expect(res.ok).toBe(true);
    expect(await res.text()).toBe("hello-bytes");
    await s.del(key);
    await expect(s.get(key)).rejects.toThrow();
    await expect(s.put("../escape", Buffer.from("x"), "text/plain")).rejects.toThrow(/Invalid storage key/);
    process.env.STORAGE_DRIVER = "local"; resetStorageForTests();
  });
});
