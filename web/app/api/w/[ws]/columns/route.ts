import { z } from "zod";
import { parse, wsHandler } from "@/lib/api";
import { createColumn } from "@/lib/server/kanban";
export const POST = wsHandler("board.configure", async (req, c) => {
  const b = await parse(req, z.object({ name: z.string().max(40), kind: z.enum(["backlog", "active", "blocked", "done"]).default("active") }));
  await createColumn({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, b.name, b.kind);
});
