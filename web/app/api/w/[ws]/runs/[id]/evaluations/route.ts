import { z } from "zod";
import { parse, wsHandler } from "@/lib/api";
import { startEvaluation } from "@/lib/server/training";
const a = (c: { user: { id: string }; role: any; workspaceId: string; slug: string }) => ({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug });
export const POST = wsHandler<{ ws: string; id: string }>("training.run", async (req, c, p) => startEvaluation(a(c), p.id, (await parse(req, z.object({ split: z.enum(["train", "val", "test"]) }))).split));
