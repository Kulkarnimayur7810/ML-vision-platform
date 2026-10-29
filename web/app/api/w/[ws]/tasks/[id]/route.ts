import { parse, wsHandler } from "@/lib/api";
import { updateTask } from "@/lib/server/kanban";
import { taskPatch, uuid } from "@/lib/schemas";
export const PATCH = wsHandler<{ ws: string; id: string }>("workspace.view", async (req, c, p) =>
  ({ task: await updateTask({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, uuid.parse(p.id), await parse(req, taskPatch)) }));
