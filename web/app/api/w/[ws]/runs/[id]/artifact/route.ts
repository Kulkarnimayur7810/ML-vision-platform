import { NextResponse } from "next/server";
import { wsHandler } from "@/lib/api";
import { artifactUrl } from "@/lib/server/training";
import { badRequest } from "@/lib/errors";
export const GET = wsHandler<{ ws: string; id: string }>("workspace.view", async (req, c, p) => {
  const which = new URL(req.url).searchParams.get("which") ?? "best";
  if (which !== "best" && which !== "last") throw badRequest("which must be best or last");
  const r = await artifactUrl(c.workspaceId, p.id, which);
  return NextResponse.redirect(new URL(r.url, req.url), 302);
});
