import { wsHandler } from "@/lib/api";
import { workload } from "@/lib/server/kanban";
export const GET = wsHandler("workspace.view", async (req, c) => workload(c.workspaceId, Math.min(365, Number(new URL(req.url).searchParams.get("days")) || 30)));
