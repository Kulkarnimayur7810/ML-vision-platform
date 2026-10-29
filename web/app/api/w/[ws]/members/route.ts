import { z } from "zod";
import { parse, wsHandler } from "@/lib/api";
import { changeRole, createMemberAccount, listInvites, listMembers, removeMember, resetMemberPassword, revokeInvite } from "@/lib/server/team";
import { createInvite } from "@/lib/server/auth";
import { forbidden } from "@/lib/errors";
import { can } from "@/lib/authz";
import { role, uuid } from "@/lib/schemas";

export const GET = wsHandler("workspace.view", async (_r, c) => ({
  members: await listMembers(c.workspaceId),
  invites: can(c.role, "invites.create") ? await listInvites(c.workspaceId) : [],
}));

/** One endpoint, discriminated by `action`; every branch re-checks the permission in the service layer. */
export const POST = wsHandler("workspace.view", async (req, c) => {
  const a = { id: c.user.id, role: c.role, workspaceId: c.workspaceId };
  const b = await parse(req, z.discriminatedUnion("action", [
    z.object({ action: z.literal("invite"), role, email: z.string().email().max(320).nullable().optional() }),
    z.object({ action: z.literal("create"), role, email: z.string().max(320), displayName: z.string().max(100) }),
    z.object({ action: z.literal("role"), userId: uuid, role }),
    z.object({ action: z.literal("remove"), userId: uuid }),
    z.object({ action: z.literal("reset"), userId: uuid }),
    z.object({ action: z.literal("revoke"), inviteId: uuid }),
  ]));
  switch (b.action) {
    case "invite": {
      if (!can(c.role, "invites.create")) throw forbidden();
      if (c.role !== "owner" && b.role === "admin") throw forbidden("Only the owner can invite admins.");
      return { token: await createInvite(c.workspaceId, c.user.id, b.role, b.email) };
    }
    case "create": return createMemberAccount(a, b);
    case "role": return changeRole(a, b.userId, b.role);
    case "remove": return removeMember(a, b.userId);
    case "reset": return { tempPassword: await resetMemberPassword(a, b.userId) };
    case "revoke": return revokeInvite(a, b.inviteId);
  }
});
