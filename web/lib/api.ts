import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AppError, forbidden, notFound, unauthorized } from "./errors";
import { currentUser, type SessionUser } from "./auth/session";
import { sql } from "./db";
import { can, type Perm, type Role } from "./authz";

export type Ctx<P = Record<string, string>> = { params: Promise<P> };

function assertSameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients (curl, worker) carry no cookie-borne risk; same-site fetches always send Origin
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (new URL(origin).host !== host) throw forbidden("Cross-site request blocked");
}

export function handler<P = Record<string, string>>(fn: (req: NextRequest, ctx: Ctx<P>) => Promise<unknown>) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      assertSameOrigin(req);
      const out = await fn(req, ctx);
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      if (e instanceof AppError) return NextResponse.json({ error: { code: e.code, message: e.message, ...e.extra } }, { status: e.status });
      if (e instanceof ZodError) return NextResponse.json({ error: { code: "invalid", message: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") } }, { status: 400 });
      console.error("API error", e);
      return NextResponse.json({ error: { code: "server_error", message: "Something went wrong on the server." } }, { status: 500 });
    }
  };
}

export async function apiUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw unauthorized();
  if (u.mustChangePassword) throw new AppError(403, "password_change_required", "Change your temporary password first");
  return u;
}

export async function parse<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let json: unknown;
  try { json = await req.json(); } catch { json = {}; }
  return schema.parse(json);
}

export type WsCtx = { user: SessionUser; workspaceId: string; slug: string; role: Role };

/** Resolve a workspace by slug for the signed-in user. Non-members get 404 (not 403) so IDs can't be probed. */
export async function workspaceFor(user: SessionUser, slug: string): Promise<WsCtx> {
  const [r] = await sql()`select w.id, w.slug, m.role from workspaces w join workspace_members m on m.workspace_id = w.id where w.slug = ${slug} and m.user_id = ${user.id}`;
  if (!r) throw notFound("Workspace not found");
  return { user, workspaceId: r.id, slug: r.slug, role: r.role };
}
export function need(ctx: WsCtx, perm: Perm) { if (!can(ctx.role, perm)) throw forbidden(); }

export function wsHandler<P extends { ws: string } = { ws: string }>(perm: Perm | null, fn: (req: NextRequest, c: WsCtx, params: P) => Promise<unknown>) {
  return handler<P>(async (req, ctx) => {
    const user = await apiUser();
    const params = await ctx.params;
    const c = await workspaceFor(user, params.ws);
    if (perm) need(c, perm);
    return fn(req, c, params);
  });
}
