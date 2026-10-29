import { test, expect } from "@playwright/test";
import { signIn, SLUG } from "./helpers";
import { USERS } from "./global-setup";

test.describe("private access", () => {
  test("every page redirects anonymous visitors to login", async ({ page }) => {
    for (const p of ["/", `/w/${SLUG}`, `/w/${SLUG}/kanban`, `/w/${SLUG}/team`, `/w/${SLUG}/kanban/tasks/1`, "/account/password", "/workspaces/new"]) {
      await page.goto(p);
      await expect(page).toHaveURL(/\/login/);
    }
  });
  test("every API answers 401 without a session", async ({ request }) => {
    for (const p of ["/api/auth/me", "/api/workspaces", `/api/w/${SLUG}/board`, `/api/w/${SLUG}/members`, `/api/w/${SLUG}/workload`, `/api/w/${SLUG}/activity`]) {
      const r = await request.get(p);
      expect(r.status(), p).toBe(401);
    }
    const r = await request.post(`/api/w/${SLUG}/tasks`, { data: { title: "x" } });
    expect(r.status()).toBe(401);
  });
  test("a forged session cookie is rejected", async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "wv_session", value: "forged-token", url: "http://localhost:3100" }]);
    const page = await ctx.newPage();
    await page.goto(`/w/${SLUG}/kanban`);
    await expect(page).toHaveURL(/\/login/);
    const r = await ctx.request.get(`/api/w/${SLUG}/board`);
    expect(r.status()).toBe(401);
    await ctx.close();
  });
  test("there is no public registration page", async ({ page }) => {
    for (const p of ["/register", "/signup", "/sign-up"]) {
      await page.goto(p);
      await expect(page).toHaveURL(/\/login/); // anonymous visitors only ever reach the sign-in form
      await expect(page.getByRole("link", { name: /sign up|register/i })).toHaveCount(0);
    }
    const signedIn = await page.request.post("/api/auth/register", { data: { email: "x@y.zz", password: "Whatever-123!" } });
    expect([401, 404]).toContain(signedIn.status());
  });
  test("login shows a clear error and then works with no verification step", async ({ page }) => {
    await signIn(page, USERS.owner.email, "wrong-password-1");
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
    await signIn(page, USERS.owner.email);
    await expect(page).toHaveURL(new RegExp(`/w/${SLUG}`));
    await expect(page.getByRole("heading", { name: /Welcome, Olivia/ })).toBeVisible();
  });
  test("sign out ends the session", async ({ page }) => {
    await signIn(page, USERS.eng.email);
    await page.waitForURL(/\/w\//);
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto(`/w/${SLUG}/kanban`);
    await expect(page).toHaveURL(/\/login/);
  });
  test("responses carry security headers and are not indexable", async ({ request }) => {
    const r = await request.get("/login");
    expect(r.headers()["x-frame-options"]).toBe("DENY");
    expect(r.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(r.headers()["x-robots-tag"]).toContain("noindex");
    expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /");
  });
  test("session cookie is httpOnly", async ({ page, context }) => {
    await signIn(page, USERS.mem.email);
    await page.waitForURL(/\/w\//);
    const c = (await context.cookies()).find((x) => x.name === "wv_session");
    expect(c?.httpOnly).toBe(true);
    expect(c?.sameSite).toBe("Lax");
  });
});

test.describe("workspace isolation", () => {
  test("a user from another team gets 404 for this workspace's pages and APIs", async ({ page }) => {
    await signIn(page, USERS.other.email);
    await page.waitForURL(/\/w\/other-team/);
    const r = await page.goto(`/w/${SLUG}/kanban`);
    expect(r?.status()).toBe(404);
    for (const p of ["board", "members", "workload", "activity", "notifications"]) {
      const res = await page.request.get(`/api/w/${SLUG}/${p}`);
      expect(res.status(), p).toBe(404);
    }
    const post = await page.request.post(`/api/w/${SLUG}/tasks`, { data: { title: "intruder" } });
    expect(post.status()).toBe(404);
  });
  test("task ids from another workspace are unreachable through your own", async ({ page }) => {
    await signIn(page, USERS.owner.email);
    await page.waitForURL(/\/w\//);
    const mine = await (await page.request.get(`/api/w/${SLUG}/board`)).json();
    expect(JSON.stringify(mine)).not.toContain("Other team secret");
    const bogus = await page.request.patch(`/api/w/${SLUG}/tasks/00000000-0000-4000-8000-000000000000`, { data: { version: 1, title: "x" } });
    expect(bogus.status()).toBe(404);
  });
});
