import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { workspaceFor } from "@/lib/api";
import { KanbanApp } from "@/components/kanban/kanban-app";

export const metadata = { title: "Team Kanban" };
export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const u = await currentUser();
  if (!u) redirect("/login");
  const { ws } = await params;
  const c = await workspaceFor(u, ws);
  return <Suspense fallback={<p className="p-4 text-sm text-fg-subtle">Loading…</p>}><KanbanApp slug={c.slug} role={c.role} me={u.id} /></Suspense>;
}
