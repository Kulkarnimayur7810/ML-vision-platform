import { wsHandler } from "@/lib/api";
import { qualityReport } from "@/lib/server/quality";
export const GET = wsHandler<{ ws: string; id: string }>("workspace.view", async (_r, c, p) => qualityReport(c.workspaceId, p.id));
