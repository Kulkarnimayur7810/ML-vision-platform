import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { workspaceFor } from "@/lib/api";
import { NewRun } from "@/components/training/new-run";
import { can } from "@/lib/authz";
export const metadata = { title: "New training run" };
export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const u = await currentUser(); if (!u) redirect("/login");
  const p = await params;
  const c = await workspaceFor(u, p.ws);
  if (!can(c.role, "training.run")) redirect(`/w/${c.slug}/training`);
  return <NewRun slug={c.slug} />;
}
