import { z } from "zod";
import { apiUser, handler, parse } from "@/lib/api";
import { createWorkspace, listWorkspaces } from "@/lib/server/workspaces";
import { sql } from "@/lib/db";
import { forbidden } from "@/lib/errors";
export const GET = handler(async () => ({ workspaces: await listWorkspaces((await apiUser()).id) }));
// Creating extra workspaces is limited to people who already own one (no open sign-up).
export const POST = handler(async (req) => {
  const u = await apiUser();
  const [own] = await sql()`select 1 from workspace_members where user_id = ${u.id} and role = 'owner'`;
  const [any] = await sql()`select 1 from workspaces limit 1`;
  if (any && !own) throw forbidden("Only a workspace owner can create another workspace.");
  const b = await parse(req, z.object({ name: z.string().min(2).max(60), description: z.string().max(300).optional() }));
  return createWorkspace(u.id, b.name, b.description);
});
