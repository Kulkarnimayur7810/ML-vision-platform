import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { signIn, signInTo, SLUG, uid } from "./helpers";
import { USERS } from "./global-setup";

async function jpg(n: number) {
  const size = 320, raw = Buffer.alloc(size * size * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 11 + n * 97 + ((i / 3) % 17) * n) & 255;
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).jpeg().toBuffer();
}
let dsName = "";
let dsUrl = "";

async function draw(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.getByTestId("canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * ((from[0] + to[0]) / 2), box.y + box.height * ((from[1] + to[1]) / 2), { steps: 4 });
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 4 });
  await page.mouse.up();
}

test.describe.serial("datasets & annotation", () => {
  test("engineer creates a detection dataset, uploads images and sees duplicates rejected", async ({ page }) => {
    dsName = "Belt " + uid();
    await signInTo(page, USERS.eng.email, `/w/${SLUG}/datasets`);
    await expect(page.getByText("No datasets yet")).toBeVisible();
    await page.getByRole("button", { name: "Create the first dataset" }).click();
    await expect(page.getByText("Cannot tell where items are")).toBeVisible(); // classification vs detection is explained
    await page.getByLabel("Name").fill(dsName);
    await page.getByRole("button", { name: "Create dataset" }).click();
    await expect(page.getByRole("heading", { name: new RegExp(dsName) })).toBeVisible();
    await page.waitForURL(/datasets\/[0-9a-f-]{36}$/);
    dsUrl = page.url();
    const imgs = await Promise.all([1, 2, 3, 4].map(jpg));
    await page.getByLabel("Choose images to upload").setInputFiles([
      ...imgs.map((b, i) => ({ name: `img${i}.jpg`, mimeType: "image/jpeg", buffer: b })),
      { name: "copy.jpg", mimeType: "image/jpeg", buffer: imgs[0] },
      { name: "notes.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not really an image") },
    ]);
    await expect(page.getByText(/4 added, 1 duplicate skipped, 1 rejected/)).toBeVisible();
    await expect(page.getByTestId("grid").getByRole("link")).toHaveCount(4);
    await expect(page.locator("p", { hasText: "Next step:" })).toContainText("4 image(s) still need labels");
  });

  test("draw boxes on the canvas, save, and the labels persist after reload", async ({ page }) => {
    await signInTo(page, USERS.eng.email, dsUrl.replace(/^https?:\/\/[^/]+/, "") + "/annotate");
    await expect(page.getByTestId("canvas")).toBeVisible();
    await expect(page.getByTestId("position")).toHaveText("1 / 4");
    await page.waitForTimeout(500);
    await draw(page, [0.1, 0.1], [0.4, 0.4]);
    await page.getByRole("button", { name: /^metal/ }).click();
    await draw(page, [0.5, 0.5], [0.8, 0.9]);
    await expect(page.getByTestId("box-list").getByRole("button")).toHaveCount(2);
    await expect(page.getByTestId("save-state")).toContainText("Unsaved");
    await page.keyboard.press("Control+s");
    await expect(page.getByTestId("save-state")).toContainText("All changes saved");
    await page.reload();
    await expect(page.getByTestId("box-list").getByRole("button")).toHaveCount(2);
    await expect(page.getByTestId("box-list")).toContainText("metal");
  });

  test("undo/redo and delete via keyboard", async ({ page }) => {
    await signInTo(page, USERS.eng.email, dsUrl.replace(/^https?:\/\/[^/]+/, "") + "/annotate");
    await page.waitForTimeout(500);
    const list = page.getByTestId("box-list").getByRole("button");
    const before = await list.count();
    await draw(page, [0.6, 0.1], [0.9, 0.3]);
    await expect(list).toHaveCount(before + 1);
    await page.keyboard.press("Control+z");
    await expect(list).toHaveCount(before);
    await page.keyboard.press("Control+Shift+z");
    await expect(list).toHaveCount(before + 1);
    await list.last().click();            // select the box, then delete it from the keyboard
    await page.keyboard.press("Delete");
    await expect(list).toHaveCount(before);
    await page.keyboard.press("Control+s");
    await expect(page.getByTestId("save-state")).toContainText("All changes saved");
  });

  test("two people editing the same image: the second save is stopped with a clear message", async ({ page, browser }) => {
    await signInTo(page, USERS.eng.email, dsUrl.replace(/^https?:\/\/[^/]+/, "") + "/annotate");
    await page.waitForTimeout(500);
    const ctx = await browser.newContext(); const p2 = await ctx.newPage();
    await signInTo(p2, USERS.ann.email, page.url().replace(/^https?:\/\/[^/]+/, ""));
    await p2.waitForTimeout(500);
    await draw(p2, [0.2, 0.6], [0.4, 0.8]);
    await p2.keyboard.press("Control+s");
    await expect(p2.getByTestId("save-state")).toContainText("All changes saved");
    await draw(page, [0.7, 0.2], [0.9, 0.4]);
    await page.keyboard.press("Control+s");
    await expect(page.getByText(/Someone else changed this image's labels/)).toBeVisible();
    await ctx.close();
  });

  test("review: annotators can't review, fixes need a note, self-approval is blocked, another reviewer approves", async ({ page, browser }) => {
    const path = dsUrl.replace(/^https?:\/\/[^/]+/, "");
    const base = path.replace("/w/", "/api/w/");
    const ctx = await browser.newContext(); const ann = await ctx.newPage();
    await signInTo(ann, USERS.ann.email, path);
    expect(await ann.request.post(`${base}/versions`, { data: {} }).then((r) => r.status())).toBe(403);   // annotators can't create versions
    expect(await ann.request.post(`${base}/images`, { multipart: {} }).then((r) => r.status())).toBe(403); // ...or upload
    // The annotator labels every image that still needs it (through the same API the canvas uses).
    const list = await (await ann.request.get(`${base}/images?limit=50`)).json();
    let annotatorImage = "";
    for (const i of list.items) {
      const a = await (await ann.request.get(`${base}/images/${i.id}/annotation`)).json();
      if (a.image.status === "unlabeled" || a.image.status === "needs_fixes") {
        const r = await ann.request.put(`${base}/images/${i.id}/annotation`, { data: { version: a.image.version, boxes: [{ classIndex: 0, cx: .5, cy: .5, w: .3, h: .3 }] } });
        expect(r.ok()).toBe(true);
        annotatorImage ||= i.id;
      }
    }
    expect(annotatorImage).not.toBe("");
    expect((await ann.request.post(`${base}/images/${annotatorImage}/review`, { data: { decision: "approve" } })).status()).toBe(403);

    // An engineer reviews Anya's work in the UI.
    await signInTo(page, USERS.eng.email, `${path}/annotate/${annotatorImage}?mode=review`);
    await page.getByRole("button", { name: "Needs fixes" }).click();
    await expect(page.getByText(/what needs fixing/)).toBeVisible();
    await page.getByLabel("Review note").fill("Box is too loose");
    await page.getByRole("button", { name: "Needs fixes" }).click();
    await expect.poll(async () => (await (await ann.request.get(`${base}/images/${annotatorImage}/annotation`)).json()).image.reviewNote).toBe("Box is too loose");

    // Anya fixes it; the engineer approves; an engineer can't approve labels they made themselves.
    const cur = await (await ann.request.get(`${base}/images/${annotatorImage}/annotation`)).json();
    expect(cur.image.status).toBe("needs_fixes");
    await ann.request.put(`${base}/images/${annotatorImage}/annotation`, { data: { version: cur.image.version, boxes: [{ classIndex: 0, cx: .5, cy: .5, w: .2, h: .2 }] } });
    expect((await page.request.post(`${base}/images/${annotatorImage}/review`, { data: { decision: "approve" } })).status()).toBe(200);
    const mine = list.items.find((i: { id: string }) => i.id !== annotatorImage);
    const own = await page.request.put(`${base}/images/${mine.id}/annotation`, { data: { version: (await (await page.request.get(`${base}/images/${mine.id}/annotation`)).json()).image.version, boxes: [{ classIndex: 1, cx: .5, cy: .5, w: .2, h: .2 }] } });
    expect(own.ok()).toBe(true);
    const selfApprove = await page.request.post(`${base}/images/${mine.id}/review`, { data: { decision: "approve" } });
    expect(selfApprove.status()).toBe(403);
    expect((await selfApprove.json()).error.message).toMatch(/another reviewer/);
    await ctx.close();
  });

  test("owner approves everything, creates a version, and the split matches", async ({ page }) => {
    const path = dsUrl.replace(/^https?:\/\/[^/]+/, "");
    const base = path.replace("/w/", "/api/w/");
    await signInTo(page, USERS.owner.email, path);
    const list = await (await page.request.get(`${base}/images?limit=50`)).json();
    for (const i of list.items) await page.request.post(`${base}/images/${i.id}/review`, { data: { decision: "approve" } });
    await page.reload();
    await expect(page.locator("p", { hasText: "Next step:" })).toContainText(/create a version/i);
    await page.getByRole("tab", { name: "Versions" }).click();
    await page.getByRole("button", { name: "Create version" }).click();
    await expect(page.getByText(/Created v1/)).toBeVisible();
    await expect(page.getByTestId("versions")).toContainText("4 images");
  });

  test("quality tab reports real findings and class balance", async ({ page }) => {
    const path = dsUrl.replace(/^https?:\/\/[^/]+/, "");
    await signInTo(page, USERS.eng.email, path);
    await page.getByRole("tab", { name: "Quality" }).click();
    await expect(page.getByTestId("distribution")).toContainText("plastic");
    await expect(page.getByTestId("issues")).toContainText("fewer than 10 examples");
  });

  test("files and datasets are private: anonymous, other-team and forged requests fail", async ({ page, browser, request }) => {
    const path = dsUrl.replace(/^https?:\/\/[^/]+/, "");
    const base = path.replace("/w/", "/api/w/");
    await signInTo(page, USERS.eng.email, path);
    const thumb = await page.getByTestId("grid").locator("img").first().getAttribute("src");
    expect(thumb).toMatch(/^\/api\/files\//);
    expect((await page.request.get(thumb!)).status()).toBe(200);
    expect((await request.get(thumb!)).status()).toBe(401);                            // anonymous
    expect((await page.request.get(thumb!.replace(/s=[0-9a-f]+/, "s=deadbeef"))).status()).toBe(404); // forged signature
    expect((await page.request.get(thumb!.replace(/e=\d+/, "e=1"))).status()).toBe(404);              // expired
    const ctx = await browser.newContext(); const other = await ctx.newPage();
    await signIn(other, USERS.other.email); await other.waitForURL(/\/w\/other-team/);
    expect((await other.request.get(thumb!)).status()).toBe(404);                      // other team, valid signature
    expect((await other.request.get(base)).status()).toBe(404);
    expect((await other.request.get(`${base}/images`)).status()).toBe(404);
    expect((await other.request.get(`/api/w/other-team/datasets/${path.split("/").pop()}`)).status()).toBe(404); // right workspace, wrong dataset id
    expect((await other.request.get(thumb!.replace(/\/d\/[^/]+\//, "/d/x/").replace("w/", "w/"))).status()).toBeGreaterThanOrEqual(400);
    expect((await request.get(`${base}/images`)).status()).toBe(401);
    await ctx.close();
  });

  test("classification datasets label a whole image with one class", async ({ page }) => {
    await signInTo(page, USERS.eng.email, `/w/${SLUG}/datasets`);
    await page.getByRole("button", { name: "New dataset" }).click();
    await page.getByLabel("Name").fill("Cls " + uid());
    await page.getByText("Image classification").click();
    await page.getByRole("button", { name: "Create dataset" }).click();
    await page.getByLabel("Choose images to upload").setInputFiles([{ name: "a.jpg", mimeType: "image/jpeg", buffer: await jpg(9) }, { name: "b.jpg", mimeType: "image/jpeg", buffer: await jpg(10) }]);
    await expect(page.getByText(/2 added/)).toBeVisible();
    await page.getByRole("link", { name: "Label images" }).click();
    await expect(page.getByText("This image shows")).toBeVisible();
    await page.getByRole("button", { name: /^paper/ }).click();
    await expect(page.getByTestId("position")).toHaveText("2 / 2");   // auto-advanced after saving
    await page.goBack();
    await expect(page.getByRole("button", { name: /^paper/ })).toHaveAttribute("aria-pressed", "true");
  });
});
