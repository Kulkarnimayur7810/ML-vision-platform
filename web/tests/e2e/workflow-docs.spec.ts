import { test, expect } from "@playwright/test";
import { signInTo, SLUG } from "./helpers";
import { USERS } from "./global-setup";

let docPath = "";
test.describe.serial("documentation and guide", () => {
  test("a project member creates a document from a template, edits it with live preview and saves", async ({ page }) => {
    await signInTo(page, USERS.mem.email, `/w/${SLUG}/docs`);
    await expect(page.getByText("No documents yet")).toBeVisible();
    await page.getByRole("button", { name: "New document" }).click();
    await page.getByRole("button", { name: /Labeling guidelines/ }).click();
    await page.waitForURL(/\/docs\/[0-9a-f-]{36}\?edit=1/);
    docPath = new URL(page.url()).pathname;
    await expect(page.getByLabel("Title")).toHaveValue("Labeling guidelines");
    await page.getByLabel("Title").fill("Belt labeling rules");
    const ta = page.getByLabel("Document text (Markdown)");
    await expect(ta).toHaveValue(/## Boxes/);
    await ta.fill("# Rules\n\nDraw **tight** boxes.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [ ] check\n\n<script>window.__pwned=1</script>\n\n[bad](javascript:window.__pwned=2)");
    await expect(page.getByLabel("Preview").getByRole("heading", { name: "Rules" })).toBeVisible();
    await expect(page.getByLabel("Preview").locator("strong")).toHaveText("tight");
    await expect(page.getByLabel("Preview").getByRole("table")).toBeVisible();
    await expect(page.getByTestId("doc-state")).toHaveText("Unsaved changes");
    await page.keyboard.press("Control+s");
    await expect(page.getByTestId("doc-state")).toHaveText("All changes saved");
    // link a dataset and a task by number
    await page.getByLabel("Item to link").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Add link" }).click();
    await page.getByLabel("Link type").selectOption("task");
    await page.getByLabel("Task number").fill("1");
    await page.getByRole("button", { name: "Add link" }).click();
    await page.keyboard.press("Control+s");
    await expect(page.getByTestId("doc-state")).toHaveText("All changes saved");
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page).not.toHaveURL(/edit=1/);
    await page.reload();
    await expect(page.getByTestId("doc-body").getByRole("heading", { name: "Rules" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Tiny/ })).toBeVisible();                // dataset link resolves to a real name
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined(); // raw HTML and javascript: URLs never run
    await expect(page.getByTestId("doc-body").locator("script")).toHaveCount(0);
    expect(await page.getByRole("link", { name: "bad" }).getAttribute("href")).not.toMatch(/^javascript:/i);
  });

  test("two people editing: the second save is stopped; search finds text", async ({ page, browser }) => {
    await signInTo(page, USERS.mem.email, docPath + "?edit=1");
    const ctx = await browser.newContext(); const p2 = await ctx.newPage();
    await signInTo(p2, USERS.ann.email, docPath + "?edit=1");
    await p2.getByLabel("Document text (Markdown)").fill("Annotator edit about conveyor lighting");
    await p2.keyboard.press("Control+s");
    await expect(p2.getByTestId("doc-state")).toHaveText("All changes saved");
    await page.getByLabel("Document text (Markdown)").fill("stale edit");
    await page.keyboard.press("Control+s");
    await expect(page.getByText(/Someone else edited this document/)).toBeVisible();
    await ctx.close();
    await page.goto(`/w/${SLUG}/docs`);
    await page.getByLabel("Search documents").fill("conveyor lighting");
    await expect(page.getByTestId("docs").getByRole("link")).toHaveCount(1);
    await page.getByLabel("Search documents").fill("zzz-no-such-text");
    await expect(page.getByText("No matching documents")).toBeVisible();
  });

  test("insert real run results into a document, labelled by split", async ({ page }) => {
    await signInTo(page, USERS.eng.email, docPath + "?edit=1");
    const runs = (await (await page.request.get(`/api/w/${SLUG}/runs`)).json()).runs as { id: string; number: number }[];
    const first = runs.find((r) => r.number === 1)!; // run #1 is the one that has a real test evaluation
    await page.getByLabel("Run to insert results from").selectOption(first.id);
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    await expect(page.getByLabel("Document text (Markdown)")).toHaveValue(/validation \(best epoch/);
    const text = await page.getByLabel("Document text (Markdown)").inputValue();
    expect(text).toMatch(/test \(evaluated\) \| \d+ \| [\d.]+% \|/);
    expect(text).not.toMatch(/NaN|undefined/);
  });

  test("other teams can't read it; archive hides it; the guide ticks reflect reality", async ({ page, browser }) => {
    const other = await browser.newContext(); const o = await other.newPage();
    await signInTo(o, USERS.other.email, "/");
    expect((await o.request.get(docPath.replace("/w/", "/api/w/"))).status()).toBe(404);
    expect((await o.request.get(`/api/w/${SLUG}/docs`)).status()).toBe(404);
    await other.close();
    const anon = await browser.newContext(); const a = await anon.newPage();
    expect((await a.request.get(docPath.replace("/w/", "/api/w/"))).status()).toBe(401);
    await anon.close();
    await signInTo(page, USERS.mem.email, docPath);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Archive document" }).click();
    await page.waitForURL(new RegExp(`/w/${SLUG}/docs$`));
    await expect(page.getByText("No documents yet")).toBeVisible();
    await page.goto(`/w/${SLUG}/help`);
    await expect(page.getByRole("heading", { name: "Guide" })).toBeVisible();
    await expect(page.getByLabel("Done").first()).toBeVisible();      // datasets exist from earlier specs
    await expect(page.getByText("Classification vs detection").first()).toBeVisible();
  });

  test("overview shows counted project status, with unmeasured results marked as such", async ({ page }) => {
    await signInTo(page, USERS.owner.email, `/w/${SLUG}`);
    const ml = page.getByTestId("ml-summary");
    await expect(ml).toContainText("Training runs");
    await expect(ml).toContainText("Registered models");
    await expect(ml).toContainText("Latest completed run");
    await expect(ml).toContainText(/Next:/);
    await expect(ml).not.toContainText(/NaN|undefined|null/);
    const rows = await (await page.request.get(`/api/w/${SLUG}/runs`)).json();
    expect(await ml.getByText(new RegExp(`^${rows.runs.length}$`)).count()).toBeGreaterThan(0); // the tile shows the real run count
  });
});
