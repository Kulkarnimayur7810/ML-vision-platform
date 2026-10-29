import { wsHandler } from "@/lib/api";
import { compareRuns } from "@/lib/server/models";
export const GET = wsHandler("workspace.view", async (req, c) => compareRuns(c.workspaceId, (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(Boolean)));
