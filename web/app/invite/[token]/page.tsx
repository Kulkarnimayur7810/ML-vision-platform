import { inviteInfo } from "@/lib/server/auth";
import { AuthCard } from "@/components/auth-card";
import { InviteForm } from "./invite-form";
import { Alert } from "@/components/ui/form";

export const metadata = { title: "Join workspace" };
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await inviteInfo(token);
  if (!info) return <AuthCard title="Invitation unavailable"><Alert>This invitation is invalid, expired or already used. Ask an admin for a new one.</Alert></AuthCard>;
  return (
    <AuthCard title={`Join ${info.workspace}`} subtitle="Create your account. No email confirmation is needed.">
      <InviteForm token={token} fixedEmail={info.email} />
    </AuthCard>
  );
}
