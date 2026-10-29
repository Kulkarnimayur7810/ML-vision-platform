import { parse, wsHandler } from "@/lib/api";
import { createDoc, createDocSchema, listDocs } from "@/lib/server/docs";
export const GET = wsHandler("workspace.view", async (req, c) => { const sp = new URL(req.url).searchParams; return { docs: await listDocs(c.workspaceId, sp.get("q") ?? undefined, sp.get("kind") ?? undefined) }; });
export const POST = wsHandler("docs.edit", async (req, c) => createDoc({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, await parse(req, createDocSchema)));
