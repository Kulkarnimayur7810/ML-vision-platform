import { z } from "zod";
import { parse, wsHandler } from "@/lib/api";
import { archiveColumn, moveColumn, updateColumn } from "@/lib/server/kanban";
import { uuid } from "@/lib/schemas";
export const PATCH = wsHandler<{ ws: string; id: string }>("board.configure", async (req, c, p) => {
  const b = await parse(req, z.object({ name: z.string().max(40).optional(), kind: z.enum(["backlog", "active", "blocked", "done"]).optional(), wipLimit: z.number().int().min(1).nullable().optional(), move: z.enum(["left", "right"]).optional() }));
  const a = { id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug };
  if (b.move) await moveColumn(a, uuid.parse(p.id), b.move);
  else await updateColumn(a, uuid.parse(p.id), b);
});
export const DELETE = wsHandler<{ ws: string; id: string }>("board.configure", async (_req, c, p) =>
  archiveColumn({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, uuid.parse(p.id)));
