import { z } from "zod";
import { parse, wsHandler } from "@/lib/api";
import { deleteView, listViews, saveView } from "@/lib/server/kanban";
import { uuid } from "@/lib/schemas";
export const GET = wsHandler("workspace.view", async (_r, c) => ({ views: await listViews(c.workspaceId, c.user.id) }));
export const POST = wsHandler("workspace.view", async (req, c) => {
  const b = await parse(req, z.object({ name: z.string().max(60), query: z.string().max(1000), shared: z.boolean().default(false) }));
  await saveView({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, b.name, b.query, b.shared);
});
export const DELETE = wsHandler("workspace.view", async (req, c) => {
  const b = await parse(req, z.object({ id: uuid }));
  await deleteView({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, b.id);
});
