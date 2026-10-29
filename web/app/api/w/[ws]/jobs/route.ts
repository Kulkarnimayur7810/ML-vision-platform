import { wsHandler } from "@/lib/api";
import { listJobs } from "@/lib/server/training";
export const GET = wsHandler("workspace.view", async (_r, c) => ({ jobs: await listJobs(c.workspaceId) }));
