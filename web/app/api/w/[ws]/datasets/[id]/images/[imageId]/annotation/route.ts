import { z } from "zod";
import { parse, wsHandler } from "@/lib/api";
import { getAnnotation, saveAnnotation } from "@/lib/server/annotations";
const box = z.object({ classIndex: z.number().int().min(0), cx: z.number(), cy: z.number(), w: z.number(), h: z.number() });
export const GET = wsHandler<{ ws: string; id: string; imageId: string }>("workspace.view", async (_r, c, p) =>
  getAnnotation({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, p.id, p.imageId));
export const PUT = wsHandler<{ ws: string; id: string; imageId: string }>("annotate", async (req, c, p) => {
  const b = await parse(req, z.object({ version: z.number().int(), boxes: z.array(box).optional(), classIndex: z.number().int().nullable().optional(), isBackground: z.boolean().optional() }));
  return saveAnnotation({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, p.id, p.imageId, b);
});
