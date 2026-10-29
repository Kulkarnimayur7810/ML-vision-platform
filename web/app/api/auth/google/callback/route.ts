import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { workspaceFor } from "@/lib/api";
import { exchangeGoogleCode, saveDriveConnection } from "@/lib/server/google-drive";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error || !code || !state) {
    return NextResponse.redirect(new URL("/login?error=google_auth_failed", req.url));
  }

  try {
    const rawState = Buffer.from(state, "base64url").toString("utf8");
    const parsedState = JSON.parse(rawState) as { slug: string; uid: string; time: number };

    const u = await currentUser();
    if (!u || u.id !== parsedState.uid) {
      return NextResponse.redirect(new URL("/login?error=session_expired", req.url));
    }

    const c = await workspaceFor(u, parsedState.slug);
    const tokens = await exchangeGoogleCode(code);
    await saveDriveConnection(c.workspaceId, u.id, tokens);

    return NextResponse.redirect(new URL(`/w/${c.slug}/datasets?drive=connected`, req.url));
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    return NextResponse.redirect(new URL("/login?error=drive_connection_failed", req.url));
  }
}
