import { parse, wsHandler } from "@/lib/api";
import { createTask } from "@/lib/server/kanban";
import { newTask } from "@/lib/schemas";
export const POST = wsHandler("tasks.create", async (req, c) => ({ task: await createTask({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, await parse(req, newTask)) }));
