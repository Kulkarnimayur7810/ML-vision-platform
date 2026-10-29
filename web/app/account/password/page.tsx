import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { AuthCard } from "@/components/auth-card";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Change password" };
export default async function PasswordPage() {
  const u = await currentUser();
  if (!u) redirect("/login");
  return (
    <AuthCard title="Change password" subtitle={u.mustChangePassword ? "Your password was set by an admin. Choose your own to continue." : undefined}>
      <PasswordForm forced={u.mustChangePassword} />
    </AuthCard>
  );
}
