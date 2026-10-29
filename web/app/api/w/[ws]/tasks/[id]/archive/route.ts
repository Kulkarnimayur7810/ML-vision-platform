import { z } from "zod";
import { parse, wsHandler } from "@/lib/api";
import { archiveTask } from "@/lib/server/kanban";
import { uuid } from "@/lib/schemas";
export const POST = wsHandler<{ ws: string; id: string }>("workspace.view", async (req, c, p) => {
  const b = await parse(req, z.object({ archive: z.boolean() }));
  await archiveTask({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, uuid.parse(p.id), b.archive);
});
