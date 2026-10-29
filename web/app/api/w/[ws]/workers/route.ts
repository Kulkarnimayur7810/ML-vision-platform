import { wsHandler } from "@/lib/api";
import { workerStatus } from "@/lib/server/training";
export const GET = wsHandler("workspace.view", async (_r, c) => workerStatus(c.workspaceId));
