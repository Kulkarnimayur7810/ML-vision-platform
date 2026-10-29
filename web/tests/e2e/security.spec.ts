import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { signInTo, SLUG } from "./helpers";
import { USERS } from "./global-setup";

/** Walks the real route tree, so a newly added API or page can't be left public by accident. */
function walk(dir: string, out: string[] = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else out.push(p); }
  return out;
}
const APP = path.resolve(process.cwd(), "app");
const fill = (p: string) => p.replace(/\[\.\.\.(\w+)\]/g, "w/x/y.bin").replace(/\[(\w+)\]/g, (_m, n) => (n === "ws" ? SLUG : n === "number" || n === "n" ? "1" : "00000000-0000-4000-8000-000000000000"));
const routes = walk(APP).filter((f) => /[\\/]route\.ts$/.test(f)).map((f) => ({ url: "/" + path.relative(APP, path.dirname(f)).split(path.sep).join("/"), src: fs.readFileSync(f, "utf8") }));
const pages = walk(APP).filter((f) => /[\\/]page\.tsx$/.test(f)).map((f) => "/" + path.relative(APP, path.dirname(f)).split(path.sep).join("/")).map((p) => (p === "/." ? "/" : p));

// Deliberately public: the sign-in/invite flow itself and robots.txt. Everything else must demand a session.
const PUBLIC_API = new Set(["/api/auth/login", "/api/auth/logout", "/api/auth/invite/[token]"]);
const PUBLIC_PAGES = new Set(["/", "/login", "/invite/[token]"]);

test("every API route rejects requests without a session (all methods)", async ({ browser }) => {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const bad: string[] = []; let checked = 0;
  for (const r of routes) {
    if (PUBLIC_API.has(r.url)) continue;
    const methods = [...r.src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
    for (const m of methods) {
      const res = await page.request.fetch(fill(r.url) + (m === "GET" ? "" : ""), { method: m, data: m === "GET" ? undefined : {}, maxRedirects: 0 });
      checked++;
      if (![401, 307, 302, 303].includes(res.status())) bad.push(`${m} ${r.url} → ${res.status()}`);
    }
  }
  await ctx.close();
  expect(checked).toBeGreaterThan(60);
  expect(bad).toEqual([]);
});

test("every page redirects anonymous visitors to the sign-in page", async ({ browser }) => {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const bad: string[] = [];
  for (const p of pages) {
    if (PUBLIC_PAGES.has(p)) continue;
    const res = await page.request.get(fill(p), { maxRedirects: 0 });
    const loc = res.headers()["location"] ?? "";
    if (!(res.status() >= 300 && res.status() < 400 && /\/login/.test(loc))) bad.push(`${p} → ${res.status()} ${loc}`);
  }
  await ctx.close();
  expect(pages.length).toBeGreaterThan(20);
  expect(bad).toEqual([]);
});

test("workspace routes return 404 (not 403) to a signed-in user from another team — no existence leak", async ({ browser }) => {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await signInTo(page, USERS.other.email, "/");
  const bad: string[] = [];
  for (const r of routes.filter((x) => x.url.startsWith("/api/w/[ws]"))) {
    for (const m of [...r.src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)].map((x) => x[1])) {
      const res = await page.request.fetch(fill(r.url), { method: m, data: m === "GET" ? undefined : {}, maxRedirects: 0 });
      if (res.status() !== 404) bad.push(`${m} ${r.url} → ${res.status()}`);
    }
  }
  for (const p of pages.filter((x) => x.startsWith("/w/[ws]"))) {
    const res = await page.request.get(fill(p), { maxRedirects: 0 });
    if (res.status() === 200) bad.push(`page ${p} → 200`);
  }
  await ctx.close();
  expect(bad).toEqual([]);
});

test("no public sign-up, no email verification, no social login anywhere in the UI or API", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("link", { name: /sign up|register|create account/i })).toHaveCount(0);
  await expect(page.getByText(/google|github|facebook|magic link|verification code|verify your email/i)).toHaveCount(0);
  for (const p of ["/register", "/signup", "/sign-up", "/api/auth/register", "/api/auth/signup"]) expect((await page.request.get(p, { maxRedirects: 0 })).status(), p).toBeGreaterThanOrEqual(300);
  expect(routes.some((r) => /register|signup|oauth|verify|otp/i.test(r.url))).toBe(false);
});

test("security headers and noindex are present", async ({ page }) => {
  const res = await page.request.get("/login");
  const h = res.headers();
  expect(h["x-frame-options"] ?? h["content-security-policy"]).toBeTruthy();
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-robots-tag"] ?? "").toMatch(/noindex/);
  expect(h["content-security-policy"]).toMatch(/frame-ancestors/);
});
