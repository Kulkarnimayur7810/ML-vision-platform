import { NextResponse } from "next/server";
import { wsHandler } from "@/lib/api";
import { modelDownload } from "@/lib/server/models";
export const GET = wsHandler<{ ws: string; id: string }>("workspace.view", async (req, c, p) => NextResponse.redirect(new URL((await modelDownload(c.workspaceId, p.id)).url, req.url), 302));
