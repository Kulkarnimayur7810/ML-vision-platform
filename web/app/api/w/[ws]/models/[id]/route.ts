import { parse, wsHandler } from "@/lib/api";
import { getModel, patchSchema, updateModel } from "@/lib/server/models";
export const GET = wsHandler<{ ws: string; id: string }>("workspace.view", async (_r, c, p) => getModel(c.workspaceId, p.id));
export const PATCH = wsHandler<{ ws: string; id: string }>("models.manage", async (req, c, p) => updateModel({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, p.id, await parse(req, patchSchema)));
