import { expect, type Page } from "@playwright/test";
import { PW } from "./global-setup";
export const SLUG = "e2e-team";
export const uid = () => Math.random().toString(36).slice(2, 7);
export async function signIn(page: Page, email: string, password = PW) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}
export async function signInTo(page: Page, email: string, path = `/w/${SLUG}`) {
  await signIn(page, email);
  await page.waitForURL(/\/w\//);
  await page.goto(path);
}
export async function openBoard(page: Page) {
  await page.goto(`/w/${SLUG}/kanban`);
  await expect(page.getByTestId("board").or(page.getByText("Your board is empty"))).toBeVisible();
  await page.waitForTimeout(300);
}
export async function createTask(page: Page, title: string, opts: { assignee?: string; column?: string } = {}) {
  await page.getByRole("button", { name: "Create task" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Create task" });
  await dlg.getByLabel("Title").fill(title);
  if (opts.column) await dlg.getByLabel("Column").selectOption({ label: opts.column });
  if (opts.assignee) await dlg.getByRole("button", { name: new RegExp(opts.assignee) }).click();
  await dlg.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByText(title).first()).toBeVisible();
}
