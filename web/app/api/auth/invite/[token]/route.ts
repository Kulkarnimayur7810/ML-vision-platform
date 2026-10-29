import { z } from "zod";
import { handler, parse, type Ctx } from "@/lib/api";
import { acceptInvite, inviteInfo } from "@/lib/server/auth";
import { createSession } from "@/lib/auth/session";
import { notFound } from "@/lib/errors";
import { sql } from "@/lib/db";

export const GET = handler<{ token: string }>(async (_req, ctx: Ctx<{ token: string }>) => {
  const i = await inviteInfo((await ctx.params).token);
  if (!i) throw notFound("This invitation is invalid, expired or already used.");
  return i;
});
export const POST = handler<{ token: string }>(async (req, ctx) => {
  const b = await parse(req, z.object({ email: z.string().max(320), displayName: z.string().max(100), password: z.string().max(200) }));
  const uid = await acceptInvite((await ctx.params).token, b);
  await createSession(uid, req.headers.get("user-agent"));
  const [w] = await sql()`select w.slug from workspaces w join workspace_members m on m.workspace_id = w.id where m.user_id = ${uid} limit 1`;
  return { ok: true, next: `/w/${w.slug}` };
});
