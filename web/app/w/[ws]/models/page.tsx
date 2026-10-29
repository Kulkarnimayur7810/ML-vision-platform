import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { workspaceFor } from "@/lib/api";
import { ModelsPage } from "@/components/models/models-page";
export const metadata = { title: "Models" };
export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const u = await currentUser(); if (!u) redirect("/login");
  const c = await workspaceFor(u, (await params).ws);
  return <ModelsPage slug={c.slug} role={c.role} />;
}
