import "./env";
import readline from "node:readline";
import { sql, closeSql } from "../lib/db";
import { migrate } from "../lib/migrations";
import { createUser } from "../lib/server/auth";
import { createWorkspace } from "../lib/server/workspaces";

// Usage: npm run create-owner            (prompts; password is read without echo)
//    or: OWNER_EMAIL=.. OWNER_NAME=.. OWNER_PASSWORD=.. WORKSPACE_NAME=.. npm run create-owner   (CI / Vercel shell)
function ask(q: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => { if (s.includes(q)) process.stdout.write(s); };
    rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(a.trim()); });
  });
}
async function main() {
  await migrate(sql());
  const [{ n }] = await sql()`select count(*)::int n from users`;
  if (n > 0 && process.env.FORCE_ADD_OWNER !== "1") {
    console.error("Users already exist. Refusing to create another owner (set FORCE_ADD_OWNER=1 to override).");
    process.exitCode = 1; return;
  }
  const email = process.env.OWNER_EMAIL || (await ask("Owner email: "));
  const name = process.env.OWNER_NAME || (await ask("Display name: "));
  const password = process.env.OWNER_PASSWORD || (await ask("Password (min 10 chars): ", true));
  const wsName = process.env.WORKSPACE_NAME || (await ask("Workspace name [WasteVision Team]: ")) || "WasteVision Team";
  const id = await createUser({ email, displayName: name, password });
  const ws = await createWorkspace(id, wsName);
  console.log(`Created owner ${email} and workspace "${wsName}" (/${ws.slug}). Sign in at /login.`);
}
main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(closeSql);
