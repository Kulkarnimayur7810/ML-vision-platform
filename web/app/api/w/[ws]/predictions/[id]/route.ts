import { wsHandler } from "@/lib/api";
import { getPrediction } from "@/lib/server/training";
export const GET = wsHandler<{ ws: string; id: string }>("workspace.view", async (_r, c, p) => getPrediction(c.workspaceId, p.id));
