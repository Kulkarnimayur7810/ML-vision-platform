import { z } from "zod";
import { parse, wsHandler } from "@/lib/api";
import { addComment } from "@/lib/server/kanban";
import { uuid } from "@/lib/schemas";
export const POST = wsHandler<{ ws: string; id: string }>("comments.create", async (req, c, p) => {
  const b = await parse(req, z.object({ body: z.string().max(10000) }));
  await addComment({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, uuid.parse(p.id), b.body);
});
