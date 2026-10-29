import { wsHandler } from "@/lib/api";
import { retryRun } from "@/lib/server/training";
const a = (c: { user: { id: string }; role: any; workspaceId: string; slug: string }) => ({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug });
export const POST = wsHandler<{ ws: string; id: string }>("training.run", async (_r, c, p) => retryRun(a(c), p.id));
