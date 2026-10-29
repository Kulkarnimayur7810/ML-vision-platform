import { z } from "zod";
import { parse, wsHandler } from "@/lib/api";
import { createLabel } from "@/lib/server/kanban";
export const POST = wsHandler("tasks.create", async (req, c) => {
  const b = await parse(req, z.object({ name: z.string().max(30), color: z.string().max(20).default("gray") }));
  return { label: await createLabel({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, b.name, b.color) };
});
