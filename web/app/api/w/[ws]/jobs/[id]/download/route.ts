import { NextResponse } from "next/server";
import { wsHandler } from "@/lib/api";
import { jobDownloadUrl } from "@/lib/server/training";
export const GET = wsHandler<{ ws: string; id: string }>("workspace.view", async (req, c, p) => NextResponse.redirect(new URL((await jobDownloadUrl(c.workspaceId, p.id)).url, req.url), 302));
