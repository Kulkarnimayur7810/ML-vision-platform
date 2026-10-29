import { test, expect } from "@playwright/test";
import { signIn, signInTo, SLUG, uid } from "./helpers";
import { USERS } from "./global-setup";

test.describe("team accounts (no email verification anywhere)", () => {
  test("owner creates an account → temp password → forced change → sign in with new password", async ({ page, browser }) => {
    const email = `new-${uid()}@e2e.test`;
    await signInTo(page, USERS.owner.email, `/w/${SLUG}/team`);
    await page.getByRole("button", { name: "Create account" }).click();
    const dlg = page.getByRole("dialog", { name: "Create team account" });
    await dlg.getByLabel("Name").fill("Nina Newcomer"); await dlg.getByLabel("Email").fill(email);
    await dlg.getByLabel("Role").selectOption({ label: "Annotator" });
    await dlg.getByRole("button", { name: "Create account" }).click();
    const temp = await page.getByLabel("Secret value").inputValue();
    expect(temp.length).toBeGreaterThanOrEqual(10);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("members").getByText(email)).toBeVisible();

    const ctx = await browser.newContext(); const p2 = await ctx.newPage();
    await signIn(p2, email, temp);
    await expect(p2).toHaveURL(/\/account\/password/);
    await p2.goto(`/w/${SLUG}/kanban`);                      // can't skip the forced change
    await expect(p2).toHaveURL(/\/account\/password/);
    expect((await p2.request.get(`/api/w/${SLUG}/board`)).status()).toBe(403);
    await p2.getByLabel("Temporary password").fill(temp);
    await p2.getByLabel("New password", { exact: true }).fill("Violet-Harbor-9931!");
    await p2.getByLabel("Repeat new password").fill("Violet-Harbor-9931!");
    await p2.getByRole("button", { name: "Save password" }).click();
    await expect(p2).toHaveURL(new RegExp(`/w/${SLUG}`));
    await p2.goto(`/w/${SLUG}/team`);
    await expect(p2.getByRole("button", { name: "Create account" })).toHaveCount(0); // annotators can't manage members
    await ctx.close();
  });

  test("invite link: single use, no confirmation, joins with the chosen role", async ({ page, browser }) => {
    await signInTo(page, USERS.owner.email, `/w/${SLUG}/team`);
    await page.getByRole("button", { name: "Invite link" }).click();
    await page.getByRole("dialog", { name: "Create invitation link" }).getByLabel("Role").selectOption({ label: "ML Engineer" });
    await page.getByRole("button", { name: "Create link" }).click();
    const link = await page.getByLabel("Secret value").inputValue();
    expect(link).toContain("/invite/");
    const ctx = await browser.newContext(); const p2 = await ctx.newPage();
    const email = `inv-${uid()}@e2e.test`;
    await p2.goto(link);
    await p2.getByLabel("Your name").fill("Ivan Invited"); await p2.getByLabel("Email").fill(email);
    await p2.getByLabel("Password").fill("Copper-Meadow-7742!");
    await p2.getByRole("button", { name: "Create account" }).click();
    await expect(p2).toHaveURL(new RegExp(`/w/${SLUG}`));
    const me = await (await p2.request.get(`/api/w/${SLUG}/members`)).json();
    expect(me.members.find((m: { email: string }) => m.email === email).role).toBe("ml_engineer");
    const p3 = await (await browser.newContext()).newPage();
    await p3.goto(link);
    await expect(p3.getByText(/invalid, expired or already used/)).toBeVisible();
    await ctx.close();
  });

  test("role changes are enforced by the server (non-admin cannot, admin cannot touch owner)", async ({ page }) => {
    await signInTo(page, USERS.eng.email);
    const members = (await (await page.request.get(`/api/w/${SLUG}/members`)).json()).members as { id: string; email: string }[];
    const mem = members.find((m) => m.email === USERS.mem.email)!;
    const r = await page.request.post(`/api/w/${SLUG}/members`, { data: { action: "role", userId: mem.id, role: "admin" } });
    expect(r.status()).toBe(403);
    const inv = await page.request.post(`/api/w/${SLUG}/members`, { data: { action: "invite", role: "member" } });
    expect(inv.status()).toBe(403);
  });

  test("shell: collapsible sidebar, theme toggle, no empty placeholder pages in navigation", async ({ page }) => {
    await signInTo(page, USERS.owner.email);
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link")).toHaveText(["Overview", "Datasets", "Annotation", "Training", "Experiments", "Models", "Test & Predict", "Jobs & workers", "Team Kanban", "Team", "Documentation", "Guide", "Settings"]);
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await page.getByRole("button", { name: /Switch to dark theme/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("mobile layout has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await signInTo(page, USERS.owner.email);
    for (const p of ["", "/kanban?view=list", "/team", "/settings", "/datasets", "/annotate", "/training", "/training/new", "/predict", "/jobs", "/experiments", "/models", "/docs", "/help"]) {
      await page.goto(`/w/${SLUG}${p}`);
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(overflow, p).toBe(false);
    }
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
  });
});
