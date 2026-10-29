import { NextResponse, type NextRequest } from "next/server";
import { apiUser, handler, workspaceFor } from "@/lib/api";
import { streamDriveFile } from "@/lib/server/google-drive";

export const GET = handler<{ ws: string; fileId: string }>(async (_req, ctx) => {
  const user = await apiUser();
  const { ws, fileId } = await ctx.params;
  const c = await workspaceFor(user, ws);

  const driveRes = await streamDriveFile(c.workspaceId, fileId);
  const contentType = driveRes.headers.get("content-type") || "image/jpeg";
  const contentLength = driveRes.headers.get("content-length");

  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
  });
  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }

  // Stream the body directly
  return new NextResponse(driveRes.body, {
    status: 200,
    headers,
  });
});
