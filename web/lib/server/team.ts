import { sql, tx } from "../db";
import { badRequest, forbidden, notFound } from "../errors";
import { can, isRole, type Role } from "../authz";
import { createUser, randomTempPassword } from "./auth";
import { hashPassword } from "../auth/password";
import { log } from "./activity";

type Actor = { id: string; role: Role; workspaceId: string };

export async function listMembers(workspaceId: string) {
  const rows = await sql()`select u.id, u.display_name, u.email, m.role, m.joined_at, u.is_active from workspace_members m join users u on u.id = m.user_id where m.workspace_id = ${workspaceId} order by u.display_name`;
  return rows.map((r) => ({ id: r.id as string, name: r.display_name as string, email: r.email as string, role: r.role as Role, joinedAt: new Date(r.joined_at).toISOString(), active: r.is_active as boolean }));
}
export async function listInvites(workspaceId: string) {
  const rows = await sql()`select id, email, role, created_at, expires_at from invitations where workspace_id = ${workspaceId} and used_at is null and expires_at > now() order by created_at desc`;
  return rows.map((r) => ({ id: r.id as string, email: r.email as string | null, role: r.role as string, createdAt: new Date(r.created_at).toISOString(), expiresAt: new Date(r.expires_at).toISOString() }));
}
export async function revokeInvite(a: Actor, id: string) {
  if (!can(a.role, "invites.create")) throw forbidden();
  await sql()`delete from invitations where id = ${id} and workspace_id = ${a.workspaceId} and used_at is null`;
}

function assertCanGrant(a: Actor, role: string) {
  if (!isRole(role)) throw badRequest("Unknown role.");
  if (role === "owner") throw badRequest("Ownership can't be granted here.");
  if (a.role !== "owner" && role === "admin") throw forbidden("Only the owner can make someone an admin.");
}

export async function changeRole(a: Actor, userId: string, role: string) {
  if (!can(a.role, "members.manage")) throw forbidden();
  assertCanGrant(a, role);
  await tx(async (t) => {
    const [m] = await t`select role from workspace_members where workspace_id = ${a.workspaceId} and user_id = ${userId} for update`;
    if (!m) throw notFound("Member not found");
    if (m.role === "owner") throw badRequest("The owner's role can't be changed.");
    if (m.role === "admin" && a.role !== "owner") throw forbidden("Only the owner can change an admin.");
    await t`update workspace_members set role = ${role} where workspace_id = ${a.workspaceId} and user_id = ${userId}`;
    await log(t, a.workspaceId, a.id, "member.role", "member", userId, `Changed a member's role to ${role}`);
  });
}

export async function removeMember(a: Actor, userId: string) {
  if (!can(a.role, "members.manage") && userId !== a.id) throw forbidden();
  await tx(async (t) => {
    const [m] = await t`select role from workspace_members where workspace_id = ${a.workspaceId} and user_id = ${userId} for update`;
    if (!m) throw notFound("Member not found");
    if (m.role === "owner") throw badRequest("The owner can't be removed.");
    if (m.role === "admin" && a.role !== "owner" && userId !== a.id) throw forbidden("Only the owner can remove an admin.");
    await t`delete from task_assignees where user_id = ${userId} and task_id in (select id from tasks where workspace_id = ${a.workspaceId})`;
    await t`delete from workspace_members where workspace_id = ${a.workspaceId} and user_id = ${userId}`;
    await log(t, a.workspaceId, a.id, "member.removed", "member", userId, "Removed a member");
  });
}

/** Admin creates an account directly: returns a one-time temporary password (no email involved). */
export async function createMemberAccount(a: Actor, input: { email: string; displayName: string; role: string }) {
  if (!can(a.role, "members.manage")) throw forbidden();
  assertCanGrant(a, input.role);
  const temp = randomTempPassword();
  const existing = (await sql()`select id from users where lower(email) = ${input.email.trim().toLowerCase()}`)[0];
  if (existing) {
    const [already] = await sql()`select 1 from workspace_members where workspace_id = ${a.workspaceId} and user_id = ${existing.id}`;
    if (already) throw badRequest("That person is already in this workspace.");
    await sql()`insert into workspace_members (workspace_id, user_id, role) values (${a.workspaceId}, ${existing.id}, ${input.role})`;
    return { userId: existing.id as string, tempPassword: null as string | null };
  }
  const id = await createUser({ email: input.email, displayName: input.displayName, password: temp, mustChange: true });
  await sql()`insert into workspace_members (workspace_id, user_id, role) values (${a.workspaceId}, ${id}, ${input.role})`;
  await log(sql(), a.workspaceId, a.id, "member.created", "member", id, `Created account for ${input.displayName}`);
  return { userId: id, tempPassword: temp };
}

export async function resetMemberPassword(a: Actor, userId: string) {
  if (!can(a.role, "members.manage")) throw forbidden();
  const [m] = await sql()`select role from workspace_members where workspace_id = ${a.workspaceId} and user_id = ${userId}`;
  if (!m) throw notFound("Member not found");
  if (m.role === "owner" && a.id !== userId) throw forbidden("Only the owner can reset their own password.");
  if (m.role === "admin" && a.role !== "owner") throw forbidden("Only the owner can reset an admin's password.");
  const temp = randomTempPassword();
  await tx(async (t) => {
    await t`update users set password_hash = ${await hashPassword(temp)}, must_change_password = true where id = ${userId}`;
    await t`delete from user_sessions where user_id = ${userId}`;
    await log(t, a.workspaceId, a.id, "member.password_reset", "member", userId, "Reset a member's password");
  });
  return temp;
}
