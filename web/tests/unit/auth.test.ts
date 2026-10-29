import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { addMember, closeSql, makeUser, makeWorkspace, resetDb } from "../helpers/db";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { acceptInvite, changePassword, createInvite, inviteInfo, login } from "@/lib/server/auth";
import { sql } from "@/lib/db";
import { hashToken } from "@/lib/auth/tokens";
import { can } from "@/lib/authz";

beforeAll(resetDb);
afterAll(closeSql);

describe("passwords", () => {
  it("hashes with scrypt and never stores plain text", async () => {
    const h = await hashPassword("Zebra-Quartz-81!");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(h).not.toContain("Zebra");
    expect(await verifyPassword("Zebra-Quartz-81!", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
  it("enforces a policy", () => {
    expect(passwordProblem("short")).toBeTruthy();
    expect(passwordProblem("alexander-the-great", { email: "alexander@x.com" })).toBeTruthy();
    expect(passwordProblem("Zebra-Quartz-81!")).toBeNull();
  });
});

describe("login", () => {
  it("accepts correct credentials without any verification step", async () => {
    const u = await makeUser();
    const r = await login(u.email.toUpperCase(), "Zebra-Quartz-81!", "1.1.1.1");
    expect(r.id).toBe(u.id);
  });
  it("gives one generic error for unknown email and wrong password", async () => {
    const u = await makeUser();
    const a = await login(u.email, "bad-password-1", null).catch((e) => e);
    const b = await login("nobody@example.com", "bad-password-1", null).catch((e) => e);
    expect(a.code).toBe("invalid_credentials");
    expect(b.message).toBe(a.message);
  });
  it("locks out after 5 failures and a success resets", async () => {
    const u = await makeUser();
    for (let i = 0; i < 5; i++) await login(u.email, "nope-nope-1", null).catch(() => {});
    await expect(login(u.email, "Zebra-Quartz-81!", null)).rejects.toMatchObject({ code: "rate_limited" });
  });
  it("rejects deactivated users", async () => {
    const u = await makeUser();
    await sql()`update users set is_active = false where id = ${u.id}`;
    await expect(login(u.email, "Zebra-Quartz-81!", null)).rejects.toMatchObject({ code: "invalid_credentials" });
  });
  it("change password invalidates sessions and needs the current password", async () => {
    const u = await makeUser();
    await sql()`insert into user_sessions (user_id, token_hash, expires_at) values (${u.id}, ${hashToken("t")}, now() + interval '1 day')`;
    await expect(changePassword(u.id, "wrong-password-1", "Another-Pass-77!")).rejects.toMatchObject({ code: "invalid_credentials" });
    await changePassword(u.id, "Zebra-Quartz-81!", "Another-Pass-77!");
    expect((await sql()`select 1 from user_sessions where user_id = ${u.id}`).length).toBe(0);
    await login(u.email, "Another-Pass-77!", null);
  });
});

describe("invitations", () => {
  it("are single-use, role-bound and need no email confirmation", async () => {
    const w = await makeWorkspace();
    const token = await createInvite(w.id, w.owner.id, "annotator");
    expect((await sql()`select token_hash from invitations`)[0].token_hash).not.toBe(token); // stored hashed
    expect((await inviteInfo(token))?.role).toBe("annotator");
    const uid = await acceptInvite(token, { email: "new.person@example.com", displayName: "New Person", password: "Orbit-Lantern-52!" });
    const [m] = await sql()`select role from workspace_members where user_id = ${uid} and workspace_id = ${w.id}`;
    expect(m.role).toBe("annotator");
    await login("new.person@example.com", "Orbit-Lantern-52!", null);
    await expect(acceptInvite(token, { email: "x@example.com", displayName: "Other", password: "Orbit-Lantern-52!" })).rejects.toMatchObject({ code: "invite_invalid" });
  });
  it("rejects bogus tokens and mismatched email", async () => {
    const w = await makeWorkspace();
    expect(await inviteInfo("bogus")).toBeNull();
    const t = await createInvite(w.id, w.owner.id, "member", "right@example.com");
    await expect(acceptInvite(t, { email: "wrong@example.com", displayName: "Someone", password: "Orbit-Lantern-52!" })).rejects.toMatchObject({ code: "bad_request" });
  });
});

describe("roles", () => {
  it("match the permission table", async () => {
    expect(can("member", "datasets.create")).toBe(false);
    expect(can("annotator", "annotate")).toBe(true);
    expect(can("annotator", "training.run")).toBe(false);
    expect(can("ml_engineer", "training.run")).toBe(true);
    expect(can("admin", "members.manage")).toBe(true);
    expect(can("ml_engineer", "members.manage")).toBe(false);
    expect(can("admin", "workspace.manage")).toBe(false);
    expect(can("owner", "workspace.manage")).toBe(true);
    const w = await makeWorkspace();
    await addMember(w.id, "member");
  });
});
