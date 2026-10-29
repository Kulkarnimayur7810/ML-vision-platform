import { parse, wsHandler } from "@/lib/api";
import { createRun, listRuns, runConfigSchema } from "@/lib/server/training";
const a = (c: { user: { id: string }; role: any; workspaceId: string; slug: string }) => ({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug });
export const GET = wsHandler("workspace.view", async (_r, c) => ({ runs: await listRuns(c.workspaceId) }));
export const POST = wsHandler("training.run", async (req, c) => createRun(a(c), await parse(req, runConfigSchema)));
