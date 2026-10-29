import { NextResponse, type NextRequest } from "next/server";

// Coarse gate: no session cookie → login (pages) or 401 (API). Real validation happens server-side on every request.
const PUBLIC_PAGES = [/^\/login$/, /^\/invite\/[^/]+$/];
const PUBLIC_API = [/^\/api\/auth\/login$/, /^\/api\/auth\/invite\/[^/]+$/];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasCookie = !!req.cookies.get("wv_session")?.value;
  if (pathname.startsWith("/api/")) {
    if (hasCookie || PUBLIC_API.some((r) => r.test(pathname))) return NextResponse.next();
    return NextResponse.json({ error: { code: "unauthorized", message: "Sign in required" } }, { status: 401 });
  }
  if (hasCookie || PUBLIC_PAGES.some((r) => r.test(pathname))) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"] };
