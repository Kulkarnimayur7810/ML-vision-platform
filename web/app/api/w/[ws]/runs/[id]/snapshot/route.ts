import { wsHandler } from "@/lib/api";
import { runSnapshot } from "@/lib/server/docs";
export const GET = wsHandler<{ ws: string; id: string }>("workspace.view", async (_r, c, p) => runSnapshot(c.workspaceId, p.id));
