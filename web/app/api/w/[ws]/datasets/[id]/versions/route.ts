import { z } from "zod";
import { parse, wsHandler } from "@/lib/api";
import { createVersion, listVersions } from "@/lib/server/versions";
export const GET = wsHandler<{ ws: string; id: string }>("workspace.view", async (_r, c, p) => ({ versions: await listVersions(c.workspaceId, p.id) }));
export const POST = wsHandler<{ ws: string; id: string }>("workspace.view", async (req, c, p) => {
  const b = await parse(req, z.object({ name: z.string().max(60).optional(), seed: z.number().int().min(0).max(1e9).optional(), ratios: z.object({ train: z.number(), val: z.number(), test: z.number() }).optional() }));
  return createVersion({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, p.id, b);
});
