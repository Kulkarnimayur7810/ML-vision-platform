import { parse, wsHandler } from "@/lib/api";
import { listModels, registerModel, registerSchema } from "@/lib/server/models";
export const GET = wsHandler("workspace.view", async (_r, c) => ({ models: await listModels(c.workspaceId) }));
export const POST = wsHandler("models.manage", async (req, c) => registerModel({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, await parse(req, registerSchema)));
