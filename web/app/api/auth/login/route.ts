import { z } from "zod";
import { handler, parse } from "@/lib/api";
import { login } from "@/lib/server/auth";
import { createSession } from "@/lib/auth/session";
import { listWorkspaces } from "@/lib/server/workspaces";

export const POST = handler(async (req) => {
  const b = await parse(req, z.object({ email: z.string().min(1).max(320), password: z.string().min(1).max(200) }));
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const u = await login(b.email, b.password, ip);
  await createSession(u.id, req.headers.get("user-agent"));
  const ws = await listWorkspaces(u.id);
  return { ok: true, mustChangePassword: u.mustChangePassword, next: u.mustChangePassword ? "/account/password" : ws[0] ? `/w/${ws[0].slug}` : "/workspaces/new" };
});
