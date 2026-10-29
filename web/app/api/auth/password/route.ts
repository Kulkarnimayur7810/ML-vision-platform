import { z } from "zod";
import { handler, parse } from "@/lib/api";
import { currentUser, createSession } from "@/lib/auth/session";
import { unauthorized } from "@/lib/errors";
import { changePassword } from "@/lib/server/auth";
import { listWorkspaces } from "@/lib/server/workspaces";

export const POST = handler(async (req) => {
  const u = await currentUser();
  if (!u) throw unauthorized();
  const b = await parse(req, z.object({ current: z.string().max(200), next: z.string().max(200) }));
  await changePassword(u.id, b.current, b.next);
  await createSession(u.id, req.headers.get("user-agent"));
  const ws = await listWorkspaces(u.id);
  return { ok: true, next: ws[0] ? `/w/${ws[0].slug}` : "/workspaces/new" };
});
