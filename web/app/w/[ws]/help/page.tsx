import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { workspaceFor } from "@/lib/api";
import { HelpPage } from "@/components/docs/help-page";
export const metadata = { title: "Guide" };
export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const u = await currentUser(); if (!u) redirect("/login");
  const p = await params;
  const c = await workspaceFor(u, p.ws);
  return <HelpPage slug={c.slug} />;
}
