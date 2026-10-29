import { test, expect, type Page } from "@playwright/test";
import { createTask, openBoard, signInTo, SLUG, uid } from "./helpers";
import { USERS } from "./global-setup";

const col = (page: Page, name: string) => page.getByTestId(`col-${name}`);

test.describe("kanban", () => {
  test("create → assign real members → persists after reload and is visible to the assignee", async ({ page, browser }) => {
    const title = "Collect bottles " + uid();
    await signInTo(page, USERS.owner.email);
    await openBoard(page);
    await createTask(page, title, { assignee: "Evan Engineer", column: "To Do" });
    await expect(col(page, "To Do").getByText(title)).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("board")).toBeVisible();
    const card = col(page, "To Do").locator('[role="button"]', { hasText: title });
    await expect(card).toBeVisible();
    await expect(card.getByLabel(/Assigned to Evan Engineer/)).toBeVisible();

    // the assignee, on another browser, sees the task and a notification
    const ctx = await browser.newContext(); const eng = await ctx.newPage();
    await signInTo(eng, USERS.eng.email, `/w/${SLUG}/kanban?assignee=me`);
    await expect(eng.getByText(title)).toBeVisible();
    await eng.getByRole("button", { name: /^Notifications/ }).click();
    await expect(eng.getByText(new RegExp(`assigned #\\d+ ${title}`))).toBeVisible();
    await ctx.close();
  });

  test("drag and drop between columns persists across reload", async ({ page }) => {
    const title = "Drag me " + uid();
    await signInTo(page, USERS.owner.email); await openBoard(page);
    await createTask(page, title, { column: "To Do" });
    const card = col(page, "To Do").locator('[role="button"]', { hasText: title });
    const target = col(page, "In Progress");
    const a = await card.boundingBox(); const b = await target.boundingBox();
    await page.mouse.move(a!.x + 30, a!.y + 20); await page.mouse.down();
    await page.mouse.move(a!.x + 60, a!.y + 40, { steps: 5 });
    await page.mouse.move(b!.x + b!.width / 2, b!.y + 120, { steps: 15 });
    await page.mouse.up();
    await expect(col(page, "In Progress").getByText(title)).toBeVisible();
    await page.reload(); await expect(page.getByTestId("board")).toBeVisible();
    await expect(col(page, "In Progress").getByText(title)).toBeVisible();
    await expect(col(page, "To Do").getByText(title)).toHaveCount(0);
  });

  test("keyboard alternative: pick up with Space, move with arrows, drop with Space", async ({ page }) => {
    const title = "Keyboard " + uid();
    await signInTo(page, USERS.owner.email); await openBoard(page);
    await createTask(page, title, { column: "To Do" });
    const card = col(page, "To Do").locator('[role="button"]', { hasText: title });
    await card.focus();
    await page.keyboard.press("Space"); await page.waitForTimeout(150);
    await page.keyboard.press("ArrowRight"); await page.waitForTimeout(150);
    await page.keyboard.press("Space");
    await expect(col(page, "In Progress").getByText(title)).toBeVisible();
    await page.reload();
    await expect(col(page, "In Progress").getByText(title)).toBeVisible();
  });

  test("status can also be changed from the task panel (no drag needed)", async ({ page }) => {
    const title = "Panel move " + uid();
    await signInTo(page, USERS.owner.email); await openBoard(page);
    await createTask(page, title, { column: "To Do" });
    await col(page, "To Do").locator('[role="button"]', { hasText: title }).click();
    const dlg = page.getByRole("dialog", { name: /Task #/ });
    await dlg.getByLabel("Status").selectOption({ label: "In Review" });
    await dlg.getByRole("button", { name: "Close" }).click();
    await expect(col(page, "In Review").getByText(title)).toBeVisible();
  });

  test("a failed move rolls back and shows an error", async ({ page }) => {
    const title = "Rollback " + uid();
    await signInTo(page, USERS.owner.email); await openBoard(page);
    await createTask(page, title, { column: "To Do" });
    await page.route("**/tasks/*/move", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "server_error", message: "boom" } }) }));
    const card = col(page, "To Do").locator('[role="button"]', { hasText: title });
    await card.focus(); await page.keyboard.press("Space"); await page.waitForTimeout(150);
    await page.keyboard.press("ArrowRight"); await page.waitForTimeout(150); await page.keyboard.press("Space");
    await expect(page.getByText(/Couldn't move task/)).toBeVisible();
    await expect(col(page, "To Do").getByText(title)).toBeVisible();
    await expect(col(page, "In Progress").getByText(title)).toHaveCount(0);
  });

  test("edits are saved with a version check; unsaved changes are flagged; conflicts are reported", async ({ page, browser }) => {
    const title = "Conflict " + uid();
    await signInTo(page, USERS.owner.email); await openBoard(page);
    await createTask(page, title, { column: "To Do" });
    await page.getByText(title).first().click();
    const dlg = page.getByRole("dialog", { name: /Task #/ });
    await dlg.getByLabel("Title", { exact: true }).fill(title + " v2");
    await expect(dlg.getByText("Unsaved changes")).toBeVisible();

    // a teammate changes the same task first
    const ctx = await browser.newContext(); const p2 = await ctx.newPage();
    await signInTo(p2, USERS.eng.email); await openBoard(p2);
    await p2.getByText(title).first().click();
    const d2 = p2.getByRole("dialog", { name: /Task #/ });
    await d2.getByLabel("Title", { exact: true }).fill(title + " (eng)");
    await d2.getByRole("button", { name: "Save changes" }).click();
    await expect(d2.getByLabel("Title", { exact: true })).toHaveValue(title + " (eng)");
    await ctx.close();

    await dlg.getByRole("button", { name: "Save changes" }).click();
    await expect(dlg.getByText(/Someone else changed this task/)).toBeVisible();
  });

  test("filters: by assignee, unassigned, search and shareable URL", async ({ page }) => {
    const a = "Alpha " + uid(), b = "Bravo " + uid();
    await signInTo(page, USERS.owner.email); await openBoard(page);
    await createTask(page, a, { assignee: "Anya Annotator" }); await createTask(page, b);
    await page.getByLabel("Filter by assignee").selectOption({ label: "Anya Annotator" });
    await expect(page.getByText(a).first()).toBeVisible(); await expect(page.getByText(b)).toHaveCount(0);
    await page.getByLabel("Filter by assignee").selectOption({ label: "Unassigned" });
    await expect(page.getByText(b).first()).toBeVisible(); await expect(page.getByText(a)).toHaveCount(0);
    await expect(page).toHaveURL(/unassigned=1/);
    await page.reload(); await expect(page.getByText(b).first()).toBeVisible(); await expect(page.getByText(a)).toHaveCount(0);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByPlaceholder("Search title or #id").fill(a.split(" ")[1]);
    await expect(page.getByText(a).first()).toBeVisible(); await expect(page.getByText(b)).toHaveCount(0);
  });

  test("overdue tasks are labelled in text, listed in the Overdue view, and counted in workload", async ({ page }) => {
    const title = "Late " + uid();
    await signInTo(page, USERS.owner.email); await openBoard(page);
    await page.getByRole("button", { name: "Create task" }).first().click();
    const dlg = page.getByRole("dialog", { name: "Create task" });
    await dlg.getByLabel("Title", { exact: true }).fill(title); await dlg.getByLabel("Due date (optional)").fill("2020-01-02");
    await dlg.getByRole("button", { name: /Evan Engineer/ }).click();
    await dlg.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByTestId("board").getByText(/Overdue · Jan 2/).first()).toBeVisible();
    await page.getByRole("tab", { name: "Overdue" }).click();
    await expect(page.getByTestId("task-list").getByText(title)).toBeVisible();
    await page.getByRole("tab", { name: "Workload" }).click();
    const row = page.getByTestId("workload").getByRole("row", { name: /Evan Engineer/ });
    await expect(row).toBeVisible();
    await expect(row.getByRole("cell").nth(3)).not.toHaveText("0");
  });

  test("subtasks, dependencies (no cycles, blocks completion) and comments", async ({ page }) => {
    const p = "Parent " + uid(), q = "Blocker " + uid();
    await signInTo(page, USERS.owner.email); await openBoard(page);
    await createTask(page, p, { column: "To Do" }); await createTask(page, q, { column: "To Do" });
    await page.getByText(p).first().click();
    const dlg = page.getByRole("dialog", { name: /Task #/ });
    await dlg.getByLabel("New subtask title").fill("Sub one " + uid());
    await dlg.getByRole("button", { name: "Add" }).click();
    await expect(dlg.getByText("0/1 done")).toBeVisible();
    await dlg.getByLabel("Add a blocking task").selectOption({ label: new RegExp(q) as never }).catch(async () => {
      const opt = dlg.getByLabel("Add a blocking task").locator("option", { hasText: q });
      await dlg.getByLabel("Add a blocking task").selectOption(await opt.getAttribute("value") as string);
    });
    await expect(dlg.getByText(/Blocked by #\d+ /).first()).toBeVisible();
    await dlg.getByLabel("Status").selectOption({ label: "Done" });
    await expect(dlg.getByText(/Blocked by unfinished/)).toBeVisible();
    await dlg.getByLabel("Write a comment").fill("Looks good");
    await dlg.getByRole("button", { name: "Comment" }).click();
    await expect(dlg.getByText("Looks good")).toBeVisible();
  });

  test("project members can read everything but only edit their own or assigned tasks", async ({ page }) => {
    const theirs = "Owner's " + uid();
    await signInTo(page, USERS.owner.email); await openBoard(page);
    await createTask(page, theirs, { column: "To Do" });
    await page.getByRole("button", { name: "Account menu" }).click(); await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
    await signInTo(page, USERS.mem.email); await openBoard(page);
    await page.getByText(theirs).first().click();
    const dlg = page.getByRole("dialog", { name: /Task #/ });
    await expect(dlg.getByText(/You can read this task/)).toBeVisible();
    await expect(dlg.getByLabel("Title", { exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Columns" })).toHaveCount(0);
  });

  test("server refuses assigning someone outside the workspace and refuses non-admin column changes", async ({ page }) => {
    await signInTo(page, USERS.eng.email);
    const board = await (await page.request.get(`/api/w/${SLUG}/board`)).json();
    const other = await page.request.post(`/api/w/${SLUG}/tasks`, { data: { title: "x", assigneeIds: ["11111111-1111-4111-8111-111111111111"] } });
    expect(other.status()).toBe(400);
    const colRes = await page.request.post(`/api/w/${SLUG}/columns`, { data: { name: "Hack" } });
    expect(colRes.status()).toBe(403);
    expect(board.columns.length).toBeGreaterThan(0);
  });

  test("archive asks for confirmation and removes the task from the board", async ({ page }) => {
    const title = "Archive " + uid();
    await signInTo(page, USERS.owner.email); await openBoard(page);
    await createTask(page, title, { column: "To Do" });
    await page.getByText(title).first().click();
    const dlg = page.getByRole("dialog", { name: /Task #/ });
    await dlg.getByRole("button", { name: "Archive task" }).click();
    await expect(dlg.getByText(/can be restored/)).toBeVisible();
    await dlg.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByText(title)).toHaveCount(0);
  });
});
