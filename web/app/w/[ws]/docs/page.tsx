import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { workspaceFor } from "@/lib/api";
import { DocsPage } from "@/components/docs/docs-page";
export const metadata = { title: "Documentation" };
export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const u = await currentUser(); if (!u) redirect("/login");
  const p = await params;
  const c = await workspaceFor(u, p.ws);
  return <DocsPage slug={c.slug} role={c.role} />;
}
