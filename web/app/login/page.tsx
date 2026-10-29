import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { AuthCard } from "@/components/auth-card";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await currentUser()) redirect("/");
  const { next } = await searchParams;
  return (
    <AuthCard title="Sign in" subtitle="Use the email and password your admin gave you.">
      <LoginForm next={next && next.startsWith("/") && !next.startsWith("//") ? next : null} />
    </AuthCard>
  );
}
