import { wsHandler } from "@/lib/api";
import { getEvaluation } from "@/lib/server/training";
export const GET = wsHandler<{ ws: string; id: string }>("workspace.view", async (_r, c, p) => getEvaluation(c.workspaceId, p.id));
