import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { workspaceFor } from "@/lib/api";
import { RunPage } from "@/components/training/run-page";
export const metadata = { title: "Training run" };
export default async function Page({ params }: { params: Promise<{ ws: string; id: string }> }) {
  const u = await currentUser(); if (!u) redirect("/login");
  const p = await params;
  const c = await workspaceFor(u, p.ws);
  return <RunPage slug={c.slug} id={p.id} role={c.role} />;
}
