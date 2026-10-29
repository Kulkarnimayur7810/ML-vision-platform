import { wsHandler } from "@/lib/api";
import { getTask, listComments, taskActivity } from "@/lib/server/kanban";
export const GET = wsHandler<{ ws: string; n: string }>("workspace.view", async (_req, c, p) => {
  const task = await getTask(c.workspaceId, Number(p.n) || 0);
  const [comments, activity] = await Promise.all([listComments(c.workspaceId, task.id), taskActivity(c.workspaceId, task.id)]);
  return { task, comments, activity };
});
