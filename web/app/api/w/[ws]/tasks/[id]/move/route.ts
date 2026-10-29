import { z } from "zod";
import { parse, wsHandler } from "@/lib/api";
import { moveTask } from "@/lib/server/kanban";
import { uuid } from "@/lib/schemas";
export const POST = wsHandler<{ ws: string; id: string }>("workspace.view", async (req, c, p) => {
  const b = await parse(req, z.object({ version: z.number().int(), columnId: uuid, beforeId: uuid.nullable().optional(), afterId: uuid.nullable().optional() }));
  return { task: await moveTask({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, uuid.parse(p.id), b) };
});
