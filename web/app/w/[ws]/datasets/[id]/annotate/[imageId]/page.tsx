import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { workspaceFor } from "@/lib/api";
import { getAnnotation } from "@/lib/server/annotations";
import { Annotator } from "@/components/annotate/annotator";

export const metadata = { title: "Annotate" };
export default async function Page({ params, searchParams }: { params: Promise<{ ws: string; id: string; imageId: string }>; searchParams: Promise<{ mode?: string }> }) {
  const u = await currentUser(); if (!u) redirect("/login");
  const { ws, id, imageId } = await params;
  const c = await workspaceFor(u, ws);
  const data = await getAnnotation({ id: u.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, id, imageId);
  return <Annotator key={imageId} slug={c.slug} role={c.role} data={data} mode={(await searchParams).mode === "review" ? "review" : "label"} />;
}
