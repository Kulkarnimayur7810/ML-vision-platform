import { wsHandler } from "@/lib/api";
import { sql } from "@/lib/db";
export const GET = wsHandler("workspace.view", async (req, c) => {
  const limit = Math.min(100, Number(new URL(req.url).searchParams.get("limit")) || 30);
  const rows = await sql()`select a.id, a.summary, a.action, a.at, u.display_name from activity a left join users u on u.id = a.actor_id where a.workspace_id = ${c.workspaceId} order by a.at desc limit ${limit}`;
  return { items: rows.map((r) => ({ id: Number(r.id), summary: r.summary, action: r.action, at: new Date(r.at).toISOString(), actor: r.display_name ?? "System" })) };
});
