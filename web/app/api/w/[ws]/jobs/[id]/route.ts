import { wsHandler } from "@/lib/api";
import { getJob } from "@/lib/server/training";
export const GET = wsHandler<{ ws: string; id: string }>("workspace.view", async (req, c, p) => getJob(c.workspaceId, p.id, Number(new URL(req.url).searchParams.get("after")) || 0));
