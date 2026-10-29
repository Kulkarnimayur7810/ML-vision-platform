import { sql, closeSql } from "@/lib/db";
import { migrate } from "@/lib/migrations";
import { createUser } from "@/lib/server/auth";
import { createWorkspace } from "@/lib/server/workspaces";
import { can, type Role } from "@/lib/authz";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/wv_test";

export async function resetDb() {
  await sql().unsafe("drop schema public cascade; create schema public;");
  await migrate(sql());
}
export { closeSql };
let n = 0;
export async function makeUser(name = "Person") {
  n++;
  const email = `u${n}-${Date.now()}@example.com`;
  const id = await createUser({ email, displayName: `${name} ${["Alpha", "Bravo", "Charlie", "Delta", "Echo"][n % 5]}${n}`, password: "Zebra-Quartz-81!" });
  return { id, email };
}
export async function makeWorkspace(owner?: { id: string }) {
  const o = owner ?? (await makeUser("Owner"));
  const ws = await createWorkspace(o.id, "Test WS " + ++n);
  return { owner: o, ...ws, actor: (id = o.id, role: Role = "owner") => ({ id, role, workspaceId: ws.id, slug: ws.slug }) };
}
export async function addMember(workspaceId: string, role: Role) {
  const u = await makeUser(role);
  await sql()`insert into workspace_members (workspace_id, user_id, role) values (${workspaceId}, ${u.id}, ${role})`;
  return u;
}
export { can };
