import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import sharp from "sharp";
import { signInTo, SLUG, uid } from "./helpers";
import { USERS } from "./global-setup";

const PY = process.env.WORKER_PYTHON ?? "/tmp/claude-0/wvenv/bin/python";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/wv_e2e";
let worker: ChildProcess | null = null;
let base = "", dsPath = "", runUrl = "", runApi = "";

async function img(n: number, cls: 0 | 1) {
  const size = 96, raw = Buffer.alloc(size * size * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = ((i * 7 + n * 31 + (i % 11) * n) & 63) + (i % 3 === (cls ? 2 : 0) ? 160 : 40);
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).jpeg().toBuffer();
}
test.afterAll(() => { worker?.kill("SIGTERM"); });

test.describe.serial("training: queue, real worker, evaluation, access control", () => {
  test("engineer prepares an approved, split classification dataset", async ({ page, browser }) => {
    await signInTo(page, USERS.eng.email, `/w/${SLUG}`);
    base = `/api/w/${SLUG}`;
    const name = "Tiny " + uid();
    const created = await page.request.post(`${base}/datasets`, { data: { name, taskType: "classify", classes: ["red", "blue"] } });
    expect(created.ok()).toBe(true);
    const { id } = await created.json();
    dsPath = `${base}/datasets/${id}`;
    const files = await Promise.all(Array.from({ length: 12 }, async (_, n) => ({ name: `t${n}.jpg`, mimeType: "image/jpeg", buffer: await img(n, (n % 2) as 0 | 1) })));
    // multipart with repeated field names: use the browser's FormData so the format matches the real uploader
    const up = await page.evaluate(async ({ url, items }) => {
      const fd = new FormData();
      for (const it of items) fd.append("files", new File([Uint8Array.from(atob(it.b64), (c) => c.charCodeAt(0))], it.name, { type: "image/jpeg" }));
      const r = await fetch(url, { method: "POST", body: fd }); return r.json();
    }, { url: `${dsPath}/images`, items: files.slice(0, 6).map((f) => ({ name: f.name, b64: f.buffer.toString("base64") })) });
    const up2 = await page.evaluate(async ({ url, items }) => {
      const fd = new FormData();
      for (const it of items) fd.append("files", new File([Uint8Array.from(atob(it.b64), (c) => c.charCodeAt(0))], it.name, { type: "image/jpeg" }));
      const r = await fetch(url, { method: "POST", body: fd }); return r.json();
    }, { url: `${dsPath}/images`, items: files.slice(6).map((f) => ({ name: f.name, b64: f.buffer.toString("base64") })) });
    expect([...up.results, ...up2.results].filter((r: { status: string }) => r.status === "added").length).toBe(12);
    const list = await (await page.request.get(`${dsPath}/images?limit=50`)).json();
    for (const [n, i] of list.items.entries()) {
      const a = await (await page.request.get(`${dsPath}/images/${i.id}/annotation`)).json();
      const filenameIdx = Number(/t(\d+)\.jpg/.exec(a.image.filename)![1]);
      expect((await page.request.put(`${dsPath}/images/${i.id}/annotation`, { data: { version: a.image.version, classIndex: filenameIdx % 2 } })).ok()).toBe(true);
      void n;
    }
    const ctx = await browser.newContext(); const owner = await ctx.newPage();
    await signInTo(owner, USERS.owner.email, `/w/${SLUG}`);
    for (const i of list.items) expect((await owner.request.post(`${dsPath}/images/${i.id}/review`, { data: { decision: "approve" } })).ok()).toBe(true);
    await ctx.close();
    const v = await page.request.post(`${dsPath}/versions`, { data: { name: "tiny", ratios: { train: 0.6, val: 0.2, test: 0.2 } } });
    expect(v.ok()).toBe(true);
  });

  test("without a worker the page says so honestly and the run waits in the queue", async ({ page }) => {
    await signInTo(page, USERS.eng.email, `/w/${SLUG}/training`);
    await expect(page.getByText("No training runs yet")).toBeVisible();
    await expect(page.getByTestId("no-worker")).toContainText("No worker is online");
    await page.getByRole("link", { name: "New training run" }).click();
    await page.getByLabel("Dataset", { exact: true }).selectOption({ index: 1 });
    await expect(page.getByLabel("Dataset version")).toBeVisible();
    await expect(page.getByText("one label for the whole image")).toBeVisible(); // classification vs detection explained
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("yolov8n-cls").or(page.getByText("YOLOv8 Nano classifier")).first()).toBeVisible();
    await page.getByLabel("Start from pretrained weights").uncheck(); // offline-safe, from scratch
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByText("Advanced settings").click();
    await page.locator("#a-ep").fill("2");
    await page.locator("#a-sz").fill("64");
    await page.locator("#a-b").fill("4");
    await page.locator("#a-d").selectOption("cpu");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("test split is only used when you run a final evaluation")).toBeVisible();
    const start = page.getByRole("button", { name: "Start training" });
    await start.dblclick(); // a double click must create exactly one run
    await page.waitForURL(/\/training\/[0-9a-f-]{36}$/);
    runUrl = page.url().replace(/^https?:\/\/[^/]+/, "");
    runApi = runUrl.replace("/w/", "/api/w/").replace("/training/", "/runs/");
    await expect(page.getByText("Waiting for a worker")).toBeVisible();
    const runs = await (await page.request.get(`${base}/runs`)).json();
    expect(runs.runs.length).toBe(1);
    expect(runs.runs[0].status).toBe("queued");
    expect(runs.runs[0].bestMetrics).toBeNull();
  });

  test("a roles check: members and annotators cannot start training", async ({ page }) => {
    await signInTo(page, USERS.mem.email, `/w/${SLUG}/training`);
    await expect(page.getByRole("link", { name: "New training run" })).toHaveCount(0);
    const r = await page.request.post(`${base}/runs`, { data: { versionId: "00000000-0000-0000-0000-000000000000", arch: "yolov8n-cls" } });
    expect(r.status()).toBe(403);
    await page.goto(`/w/${SLUG}/training/new`);
    await expect(page).toHaveURL(new RegExp(`/w/${SLUG}/training$`));
  });

  test("a real worker picks it up: progress, logs, curves, checkpoints, and a test-split evaluation", async ({ page }) => {
    test.setTimeout(240_000);
    worker = spawn(PY, ["-m", "wvworker", "run"], {
      cwd: path.resolve(process.cwd(), "../worker"),
      env: { ...process.env, DATABASE_URL: DB, STORAGE_DRIVER: "local", LOCAL_STORAGE_DIR: "/tmp/claude-0/wv-e2e-store", WORKER_DIR: "/tmp/claude-0/wv-e2e-work", WORKER_NAME: "e2e-worker", PYTHONUNBUFFERED: "1" },
      stdio: "ignore",
    });
    await signInTo(page, USERS.eng.email, runUrl);
    await expect(page.getByText("Completed").first()).toBeVisible({ timeout: 200_000 });
    await expect(page.getByText(/Best validation result/)).toBeVisible();
    await expect(page.getByText("Validation split · epoch").first()).toBeVisible();
    await expect(page.getByTestId("log")).toContainText("Completed");
    await expect(page.getByRole("img", { name: /Training loss/ })).toBeVisible();
    const dl = await page.request.get(`${runApi}/artifact?which=best`);
    expect(dl.ok()).toBe(true);
    expect((await dl.body()).length).toBeGreaterThan(100_000);
    await page.getByRole("button", { name: "Evaluate on test (final)" }).click();
    const res = page.getByTestId("eval-result");
    await expect(res).toBeVisible({ timeout: 120_000 });
    await expect(res).toContainText("Test split");
    await expect(res.getByTestId("confusion")).toBeVisible();
    await expect(res).toContainText("Top-1 accuracy (test)");
    await page.goto(`/w/${SLUG}/jobs`);
    await expect(page.getByText("e2e-worker")).toBeVisible();
    await expect(page.getByTestId("jobs")).toContainText("Evaluation");
  });

  test("test & predict returns real model output for an uploaded image", async ({ page }) => {
    test.setTimeout(120_000);
    await signInTo(page, USERS.eng.email, `/w/${SLUG}/predict`);
    await page.getByLabel("Image or short video").setInputFiles({ name: "probe.jpg", mimeType: "image/jpeg", buffer: await img(3, 1) });
    await page.getByRole("button", { name: "Run prediction" }).click();
    await expect(page.getByTestId("prediction")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("prediction")).toContainText("Model time");
  });

  test("dataset export runs on the worker and downloads a zip", async ({ page }) => {
    test.setTimeout(120_000);
    await signInTo(page, USERS.eng.email, dsPath.replace("/api/w/", "/w/"));
    await page.getByRole("tab", { name: "Versions" }).or(page.getByRole("button", { name: "Versions" })).first().click();
    await page.getByRole("button", { name: "Export zip" }).click();
    await expect(page.getByText(/Export queued/)).toBeVisible();
    await page.goto(`/w/${SLUG}/jobs`);
    const link = page.getByRole("link", { name: /Download zip/ });
    await expect(link).toBeVisible({ timeout: 90_000 });
    const href = await link.getAttribute("href");
    const z = await page.request.get(href!);
    expect(z.ok()).toBe(true);
    expect((await z.body()).subarray(0, 2).toString()).toBe("PK");
  });

  test("registry: register, version, confirm before replacing the selected model; members are read-only", async ({ page, browser }) => {
    test.setTimeout(150_000);
    await signInTo(page, USERS.eng.email, runUrl);
    await page.getByRole("button", { name: "Register as model" }).click();
    await page.getByLabel("Model name").fill("tiny-cls");
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect(page.getByText(/Registered as/)).toBeVisible();
    // a second run on the same data version, registered under the same name → v2 (v1 untouched)
    const v = (await (await page.request.get(`${base}/runs/${runApi.split("/").pop()}`)).json()).versionId;
    const r2 = await page.request.post(`${base}/runs`, { data: { versionId: v, arch: "yolov8n-cls", pretrained: false, epochs: 2, imgsz: 64, batch: 4, device: "cpu", seed: 7 } });
    expect(r2.ok()).toBe(true);
    const run2 = (await r2.json()).id;
    await expect.poll(async () => (await (await page.request.get(`${base}/runs/${run2}`)).json()).status, { timeout: 90_000 }).toBe("completed");
    expect((await page.request.post(`${base}/models`, { data: { runId: run2, name: "TINY-cls" } })).ok()).toBe(true);
    await page.goto(`/w/${SLUG}/models`);
    const cards = page.getByTestId("model");
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText("v2");
    await expect(cards.nth(1)).toContainText("test split");
    await expect(cards.nth(1)).not.toContainText("not evaluated"); // run 1 had a real test evaluation
    await expect(cards.first()).toContainText("not evaluated");   // run 2 did not, and nothing is invented
    await cards.nth(1).getByRole("button", { name: "Select for use" }).click();
    await expect(cards.nth(1)).toContainText("Selected");
    await cards.first().getByRole("button", { name: "Select for use" }).click();
    await expect(page.getByRole("dialog", { name: "Replace the selected version?" })).toContainText("v1 is currently selected");
    await page.getByRole("button", { name: "Replace" }).click();
    await expect(cards.first()).toContainText("Selected");
    await expect(cards.nth(1)).toContainText("Candidate");
    // members can see the registry but not change it
    const ctx = await browser.newContext(); const m = await ctx.newPage();
    await signInTo(m, USERS.mem.email, `/w/${SLUG}/models`);
    await expect(m.getByTestId("model")).toHaveCount(2);
    await expect(m.getByRole("button", { name: "Select for use" })).toHaveCount(0);
    expect((await m.request.post(`${base}/models`, { data: { runId: run2, name: "nope" } })).status()).toBe(403);
    await ctx.close();
  });

  test("experiments: compare two runs; missing test results are shown as missing", async ({ page }) => {
    await signInTo(page, USERS.eng.email, `/w/${SLUG}/experiments`);
    const boxes = page.getByRole("checkbox");
    await expect(boxes).toHaveCount(2);
    await boxes.nth(0).check(); await boxes.nth(1).check();
    await page.getByRole("button", { name: /Compare 2 runs/ }).click();
    const t = page.getByTestId("compare");
    await expect(t).toBeVisible();
    await expect(t).toContainText("Final test evaluation");
    await expect(t.getByText("not evaluated")).toHaveCount(2); // one per metric row, only for the run never tested
    await expect(t.getByText(/different dataset versions/)).toHaveCount(0);
    await expect(t.getByRole("img", { name: /validation top-1 accuracy by epoch/i })).toBeVisible();
  });

  test("everything is private: no session → 401, other teams → 404, signed links expire", async ({ page, browser }) => {
    const anon = await browser.newContext(); const a = await anon.newPage();
    for (const p of [`${base}/runs`, `${base}/jobs`, `${base}/workers`, `${runApi}`, `${runApi}/artifact?which=best`]) expect((await a.request.get(p, { maxRedirects: 0 })).status(), p).toBe(401);
    expect((await a.request.get(runUrl, { maxRedirects: 0 })).status()).toBeGreaterThanOrEqual(300);
    expect((await a.request.get(`/api/files/w/x/runs/y/best.pt`)).status()).toBe(401);
    await anon.close();
    // A member of another workspace can't see this team's runs by guessing ids or slugs.
    const ctx = await browser.newContext(); const o = await ctx.newPage();
    await signInTo(o, USERS.other.email, "/");
    expect((await o.request.get(`${runApi}`)).status()).toBe(404);
    expect((await o.request.get(`${runApi}/artifact?which=best`)).status()).toBe(404);
    expect((await o.request.get(`${base}/jobs`)).status()).toBe(404);
    await ctx.close();
    // A signed storage link is tied to the exact key: tampering fails.
    await signInTo(page, USERS.eng.email, `/w/${SLUG}`);
    const redirect = await page.request.get(`${runApi}/artifact?which=best`, { maxRedirects: 0 });
    const loc = redirect.headers()["location"];
    expect(loc).toMatch(/^.*\/api\/files\/w\/.*best\.pt\?e=\d+&s=[0-9a-f]+$/);
    const tampered = loc.replace("best.pt", "last.pt");
    const fresh = await browser.newContext(); const f = await fresh.newPage();
    expect((await f.request.get(tampered)).status()).toBeGreaterThanOrEqual(401);
    await fresh.close();
  });
});
