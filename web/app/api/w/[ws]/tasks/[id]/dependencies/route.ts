import { z } from "zod";
import { parse, wsHandler } from "@/lib/api";
import { addDependency, removeDependency } from "@/lib/server/kanban";
import { uuid } from "@/lib/schemas";
const body = z.object({ blockerId: uuid });
export const POST = wsHandler<{ ws: string; id: string }>("workspace.view", async (req, c, p) =>
  addDependency({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, uuid.parse(p.id), (await parse(req, body)).blockerId));
export const DELETE = wsHandler<{ ws: string; id: string }>("workspace.view", async (req, c, p) =>
  removeDependency({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, uuid.parse(p.id), (await parse(req, body)).blockerId));
