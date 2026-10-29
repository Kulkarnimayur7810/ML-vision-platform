import { sql, tx } from "../db";
import { AppError, badRequest, tooMany } from "../errors";
import { hashPassword, passwordProblem, verifyPassword } from "../auth/password";
import { hashToken, newToken } from "../auth/tokens";

const MAX_FAILS = 5, WINDOW_MIN = 15;
const DUMMY = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export async function login(email: string, password: string, ip: string | null) {
  const em = email.trim().toLowerCase();
  const db = sql();
  const [{ n }] = await db`select count(*)::int n from login_attempts where lower(email) = ${em} and not ok and at > now() - make_interval(mins => ${WINDOW_MIN}) and at > coalesce((select max(at) from login_attempts where lower(email) = ${em} and ok), '-infinity')`;
  if (n >= MAX_FAILS) throw tooMany(`Too many failed attempts. Try again in ${WINDOW_MIN} minutes.`);
  const [u] = await db`select * from users where lower(email) = ${em}`;
  const ok = await verifyPassword(password, u?.password_hash ?? DUMMY);
  const good = !!u && u.is_active && ok;
  await db`insert into login_attempts (email, ip, ok) values (${em}, ${ip}, ${good})`;
  if (!good) throw new AppError(401, "invalid_credentials", "Incorrect email or password.");
  return { id: u.id as string, mustChangePassword: u.must_change_password as boolean };
}

export async function changePassword(userId: string, current: string | null, next: string, opts: { skipCurrent?: boolean } = {}) {
  const [u] = await sql()`select * from users where id = ${userId}`;
  if (!u) throw badRequest("Account not found");
  if (!opts.skipCurrent) {
    if (!current || !(await verifyPassword(current, u.password_hash))) throw new AppError(400, "invalid_credentials", "Current password is incorrect.");
  }
  const problem = passwordProblem(next, { email: u.email, name: u.display_name });
  if (problem) throw badRequest(problem);
  if (await verifyPassword(next, u.password_hash)) throw badRequest("Choose a password different from the current one.");
  await tx(async (tx) => {
    await tx`update users set password_hash = ${await hashPassword(next)}, must_change_password = false where id = ${userId}`;
    await tx`delete from user_sessions where user_id = ${userId}`; // sign out everywhere; caller creates a fresh session
  });
}

export async function createUser(input: { email: string; displayName: string; password: string; mustChange?: boolean }) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest("Enter a valid email address.");
  const name = input.displayName.trim();
  if (name.length < 2) throw badRequest("Enter a display name.");
  const problem = passwordProblem(input.password, { email, name });
  if (problem) throw badRequest(problem);
  const [dup] = await sql()`select 1 from users where lower(email) = ${email}`;
  if (dup) throw new AppError(409, "email_taken", "An account with this email already exists.");
  const [u] = await sql()`insert into users (email, display_name, password_hash, must_change_password) values (${email}, ${name}, ${await hashPassword(input.password)}, ${input.mustChange ?? false}) returning id`;
  return u.id as string;
}

export function randomTempPassword() {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export async function createInvite(workspaceId: string, createdBy: string, role: string, email?: string | null) {
  const token = newToken();
  await sql()`insert into invitations (workspace_id, email, role, token_hash, created_by, expires_at) values (${workspaceId}, ${email?.toLowerCase() ?? null}, ${role}, ${hashToken(token)}, ${createdBy}, now() + interval '7 days')`;
  return token; // shown once to the admin; only the hash is stored. No email is sent.
}

export async function inviteInfo(token: string) {
  const [i] = await sql()`select i.role, i.email, w.name as workspace from invitations i join workspaces w on w.id = i.workspace_id where i.token_hash = ${hashToken(token)} and i.used_at is null and i.expires_at > now()`;
  return i ? { role: i.role as string, email: i.email as string | null, workspace: i.workspace as string } : null;
}

export async function acceptInvite(token: string, input: { email: string; displayName: string; password: string }) {
  return tx(async (tx) => {
    const [i] = await tx`select * from invitations where token_hash = ${hashToken(token)} and used_at is null and expires_at > now() for update`;
    if (!i) throw new AppError(410, "invite_invalid", "This invitation is invalid, expired or already used.");
    if (i.email && i.email !== input.email.trim().toLowerCase()) throw badRequest("This invitation was issued for a different email address.");
    const email = input.email.trim().toLowerCase();
    const name = input.displayName.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest("Enter a valid email address.");
    if (name.length < 2) throw badRequest("Enter a display name.");
    const problem = passwordProblem(input.password, { email, name });
    if (problem) throw badRequest(problem);
    const [dup] = await tx`select 1 from users where lower(email) = ${email}`;
    if (dup) throw new AppError(409, "email_taken", "An account with this email already exists. Ask an admin to add it to the workspace instead.");
    const [u] = await tx`insert into users (email, display_name, password_hash) values (${email}, ${name}, ${await hashPassword(input.password)}) returning id`;
    await tx`insert into workspace_members (workspace_id, user_id, role) values (${i.workspace_id}, ${u.id}, ${i.role})`;
    await tx`update invitations set used_at = now(), used_by = ${u.id} where id = ${i.id}`;
    await tx`insert into activity (workspace_id, actor_id, action, entity_type, entity_id, summary) values (${i.workspace_id}, ${u.id}, 'member.joined', 'member', ${u.id}, ${name + " joined as " + i.role})`;
    return u.id as string;
  });
}
