import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { workspaceFor } from "@/lib/api";
import { ExperimentsPage } from "@/components/models/experiments-page";
export const metadata = { title: "Experiments" };
export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const u = await currentUser(); if (!u) redirect("/login");
  const c = await workspaceFor(u, (await params).ws);
  return <ExperimentsPage slug={c.slug} />;
}
