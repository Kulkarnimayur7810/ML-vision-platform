import "server-only";
import { cookies } from "next/headers";
import { sql } from "../db";
import { hashToken, newToken } from "./tokens";

export const COOKIE = "wv_session";
export type SessionUser = { id: string; email: string; displayName: string; mustChangePassword: boolean };

const hours = () => Number(process.env.SESSION_HOURS ?? 336);

export async function createSession(userId: string, userAgent?: string | null) {
  const token = newToken();
  const expires = new Date(Date.now() + hours() * 3600_000);
  await sql()`insert into user_sessions (user_id, token_hash, expires_at, user_agent) values (${userId}, ${hashToken(token)}, ${expires}, ${userAgent ?? null})`;
  const jar = await cookies();
  jar.set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires });
}

export async function userFromToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const [r] = await sql()`
    select u.id, u.email, u.display_name, u.must_change_password from user_sessions s
    join users u on u.id = s.user_id
    where s.token_hash = ${hashToken(token)} and s.expires_at > now() and u.is_active`;
  return r ? { id: r.id, email: r.email, displayName: r.display_name, mustChangePassword: r.must_change_password } : null;
}

export async function currentUser(): Promise<SessionUser | null> {
  return userFromToken((await cookies()).get(COOKIE)?.value);
}

export async function destroySession() {
  const jar = await cookies();
  const t = jar.get(COOKIE)?.value;
  if (t) await sql()`delete from user_sessions where token_hash = ${hashToken(t)}`;
  jar.delete(COOKIE);
}
