import { wsHandler } from "@/lib/api";
import { getRun } from "@/lib/server/training";
export const GET = wsHandler<{ ws: string; id: string }>("workspace.view", async (_r, c, p) => getRun(c.workspaceId, p.id));
