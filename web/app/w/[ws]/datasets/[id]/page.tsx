import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { workspaceFor } from "@/lib/api";
import { DatasetPage } from "@/components/datasets/dataset-page";
export const metadata = { title: "Dataset" };
export default async function Page({ params }: { params: Promise<{ ws: string; id: string }> }) {
  const u = await currentUser(); if (!u) redirect("/login");
  const { ws, id } = await params;
  const c = await workspaceFor(u, ws);
  return <DatasetPage slug={c.slug} id={id} role={c.role} />;
}
