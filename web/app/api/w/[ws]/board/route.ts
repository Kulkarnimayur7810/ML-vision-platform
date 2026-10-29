import { wsHandler } from "@/lib/api";
import { getBoard } from "@/lib/server/kanban";
export const GET = wsHandler("workspace.view", async (req, c) => getBoard(c.workspaceId, new URL(req.url).searchParams.get("archived") === "1"));
