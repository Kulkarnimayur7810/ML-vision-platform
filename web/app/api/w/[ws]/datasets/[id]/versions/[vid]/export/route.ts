import { wsHandler } from "@/lib/api";
import { queueExport } from "@/lib/server/training";
const a = (c: { user: { id: string }; role: any; workspaceId: string; slug: string }) => ({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug });
export const POST = wsHandler<{ ws: string; id: string; vid: string }>("datasets.edit", async (_r, c, p) => queueExport(a(c), p.vid));
