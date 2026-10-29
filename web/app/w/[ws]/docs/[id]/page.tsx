import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { workspaceFor } from "@/lib/api";
import { DocPage } from "@/components/docs/doc-page";
export const metadata = { title: "Document" };
export default async function Page({ params }: { params: Promise<{ ws: string; id: string }> }) {
  const u = await currentUser(); if (!u) redirect("/login");
  const p = await params;
  const c = await workspaceFor(u, p.ws);
  return <DocPage slug={c.slug} id={p.id} role={c.role} />;
}
