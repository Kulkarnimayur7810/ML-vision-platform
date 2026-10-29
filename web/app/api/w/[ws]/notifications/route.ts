import { z } from "zod";
import { parse, wsHandler } from "@/lib/api";
import { sql } from "@/lib/db";
export const GET = wsHandler("workspace.view", async (_r, c) => {
  const rows = await sql()`select id, kind, title, href, read_at, at from notifications where user_id = ${c.user.id} and workspace_id = ${c.workspaceId} order by at desc limit 30`;
  return { items: rows.map((r) => ({ id: Number(r.id), kind: r.kind, title: r.title, href: r.href, read: !!r.read_at, at: new Date(r.at).toISOString() })), unread: rows.filter((r) => !r.read_at).length };
});
export const POST = wsHandler("workspace.view", async (req, c) => {
  const b = await parse(req, z.object({ ids: z.array(z.number()).optional() }));
  if (b.ids?.length) await sql()`update notifications set read_at = now() where user_id = ${c.user.id} and read_at is null and id in ${sql()(b.ids)}`;
  else await sql()`update notifications set read_at = now() where user_id = ${c.user.id} and workspace_id = ${c.workspaceId} and read_at is null`;
});
