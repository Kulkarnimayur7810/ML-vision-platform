import { sql, closeSql } from "../../lib/db";
import { migrate } from "../../lib/migrations";
import { createUser } from "../../lib/server/auth";
import { createWorkspace } from "../../lib/server/workspaces";

export const PW = "Marble-Falcon-2468!";
export const USERS = {
  owner: { email: "owner@e2e.test", name: "Olivia Owner" },
  eng: { email: "eng@e2e.test", name: "Evan Engineer" },
  ann: { email: "ann@e2e.test", name: "Anya Annotator" },
  mem: { email: "mem@e2e.test", name: "Milo Member" },
  other: { email: "other@e2e.test", name: "Otto Outsider" },
};
export default async function setup() {
  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/wv_e2e";
  await sql().unsafe("drop schema public cascade; create schema public;");
  await migrate(sql());
  const ids: Record<string, string> = {};
  for (const [k, u] of Object.entries(USERS)) ids[k] = await createUser({ email: u.email, displayName: u.name, password: PW });
  const ws = await createWorkspace(ids.owner, "E2E Team");
  for (const [k, role] of [["eng", "ml_engineer"], ["ann", "annotator"], ["mem", "member"]] as const)
    await sql()`insert into workspace_members (workspace_id, user_id, role) values (${ws.id}, ${ids[k]}, ${role})`;
  const other = await createWorkspace(ids.other, "Other Team");
  await sql()`insert into tasks (workspace_id, number, title, column_id, position, created_by) select ${other.id}, 1, 'Other team secret', id, 1024, ${ids.other} from board_columns where workspace_id = ${other.id} limit 1`;
  await sql()`update workspace_counters set next_task = 2 where workspace_id = ${other.id}`;
  await sql()`insert into labels (workspace_id, name) values (${ws.id}, 'dataset')`;
  await closeSql();
}
