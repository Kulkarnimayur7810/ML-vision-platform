import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { workspaceFor } from "@/lib/api";
import { datasetFor } from "@/lib/server/datasets";
import { nextToLabel } from "@/lib/server/annotations";
import { sql } from "@/lib/db";
import Link from "next/link";

export default async function Page({ params, searchParams }: { params: Promise<{ ws: string; id: string }>; searchParams: Promise<{ mode?: string }> }) {
  const u = await currentUser(); if (!u) redirect("/login");
  const { ws, id } = await params; const mode = (await searchParams).mode === "review" ? "review" : "label";
  const c = await workspaceFor(u, ws);
  const d = await datasetFor(c.workspaceId, id);
  let target = await nextToLabel(d.id, mode, u.id);
  if (!target && mode === "label") { const [f] = await sql()`select id from dataset_images where dataset_id = ${d.id} order by created_at, id limit 1`; target = f?.id ?? null; }
  if (target) redirect(`/w/${ws}/datasets/${id}/annotate/${target}${mode === "review" ? "?mode=review" : ""}`);
  if (mode === "review") return <div className="mx-auto max-w-md p-8 text-center"><h1 className="text-base font-semibold">Nothing to review</h1><p className="mt-1 text-sm text-fg-muted">Every labeled image has been reviewed.</p><Link className="mt-3 inline-block text-accent underline" href={`/w/${ws}/datasets/${id}`}>Back to {d.name}</Link></div>;
  notFound;
  return <div className="mx-auto max-w-md p-8 text-center"><h1 className="text-base font-semibold">No images yet</h1><p className="mt-1 text-sm text-fg-muted">Upload some images to {d.name} first.</p><Link className="mt-3 inline-block text-accent underline" href={`/w/${ws}/datasets/${id}`}>Go to dataset</Link></div>;
}
