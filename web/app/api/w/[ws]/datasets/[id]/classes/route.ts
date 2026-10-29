import { z } from "zod";
import { parse, wsHandler } from "@/lib/api";
import { addClass, updateClass } from "@/lib/server/datasets";
export const POST = wsHandler<{ ws: string; id: string }>("workspace.view", async (req, c, p) => {
  const b = await parse(req, z.object({ name: z.string().max(40) }));
  await addClass({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, p.id, b.name);
});
export const PATCH = wsHandler<{ ws: string; id: string }>("workspace.view", async (req, c, p) => {
  const b = await parse(req, z.object({ index: z.number().int().min(0), name: z.string().max(40).optional(), guideline: z.string().max(500).optional() }));
  await updateClass({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, p.id, b.index, b);
});
