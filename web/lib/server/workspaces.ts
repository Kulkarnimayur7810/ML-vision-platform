import type { Sql } from "../db";
import { sql, tx } from "../db";
import { badRequest } from "../errors";
import { log } from "./activity";

export const DEFAULT_COLUMNS: { name: string; kind: "backlog" | "active" | "blocked" | "done" }[] = [
  { name: "Backlog", kind: "backlog" }, { name: "To Do", kind: "active" }, { name: "In Progress", kind: "active" },
  { name: "In Review", kind: "active" }, { name: "Blocked", kind: "blocked" }, { name: "Done", kind: "done" },
];

export function slugify(s: string) { return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workspace"; }

export async function createWorkspace(ownerId: string, name: string, description = "", tx: Sql = sql()) {
  const n = name.trim();
  if (n.length < 2) throw badRequest("Enter a workspace name.");
  const base = slugify(n);
  let slug = base;
  for (let i = 2; (await tx`select 1 from workspaces where slug = ${slug}`).length; i++) slug = `${base}-${i}`;
  const [w] = await tx`insert into workspaces (slug, name, description, created_by) values (${slug}, ${n}, ${description}, ${ownerId}) returning id, slug`;
  await tx`insert into workspace_members (workspace_id, user_id, role) values (${w.id}, ${ownerId}, 'owner')`;
  await tx`insert into workspace_counters (workspace_id) values (${w.id})`;
  for (const [i, c] of DEFAULT_COLUMNS.entries()) await tx`insert into board_columns (workspace_id, name, position, kind) values (${w.id}, ${c.name}, ${(i + 1) * 1024}, ${c.kind})`;
  await log(tx, w.id, ownerId, "workspace.created", "workspace", w.id, `Created workspace ${n}`);
  return { id: w.id as string, slug: w.slug as string };
}

export async function listWorkspaces(userId: string) {
  const rows = await sql()`select w.id, w.slug, w.name, m.role from workspaces w join workspace_members m on m.workspace_id = w.id where m.user_id = ${userId} order by w.name`;
  return rows.map((r) => ({ id: r.id as string, slug: r.slug as string, name: r.name as string, role: r.role as string }));
}
