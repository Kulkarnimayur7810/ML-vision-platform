import { handler } from "@/lib/api";
import { currentUser } from "@/lib/auth/session";
import { unauthorized } from "@/lib/errors";
import { listWorkspaces } from "@/lib/server/workspaces";
export const GET = handler(async () => {
  const u = await currentUser();
  if (!u) throw unauthorized();
  return { user: u, workspaces: await listWorkspaces(u.id) };
});
