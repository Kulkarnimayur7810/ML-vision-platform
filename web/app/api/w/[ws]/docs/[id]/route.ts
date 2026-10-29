import { parse, wsHandler } from "@/lib/api";
import { archiveDoc, getDoc, updateDoc, updateDocSchema } from "@/lib/server/docs";
const actor = (c: { user: { id: string }; role: any; workspaceId: string; slug: string }) => ({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug });
export const GET = wsHandler<{ ws: string; id: string }>("workspace.view", async (_r, c, p) => getDoc(c.workspaceId, p.id));
export const PATCH = wsHandler<{ ws: string; id: string }>("docs.edit", async (req, c, p) => updateDoc(actor(c), p.id, await parse(req, updateDocSchema)));
export const DELETE = wsHandler<{ ws: string; id: string }>("docs.edit", async (_r, c, p) => archiveDoc(actor(c), p.id));
