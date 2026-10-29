import { z } from "zod";
import { parse, wsHandler } from "@/lib/api";
import { reviewImage } from "@/lib/server/annotations";
export const POST = wsHandler<{ ws: string; id: string; imageId: string }>("review", async (req, c, p) => {
  const b = await parse(req, z.object({ decision: z.enum(["approve", "needs_fixes"]), note: z.string().max(500).optional() }));
  await reviewImage({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, p.id, p.imageId, b);
});
