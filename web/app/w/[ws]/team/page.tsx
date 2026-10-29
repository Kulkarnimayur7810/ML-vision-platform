import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { workspaceFor } from "@/lib/api";
import { TeamPage } from "@/components/team/team-page";
export const metadata = { title: "Team" };
export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const u = await currentUser(); if (!u) redirect("/login");
  const c = await workspaceFor(u, (await params).ws);
  return <TeamPage slug={c.slug} role={c.role} me={u.id} />;
}
