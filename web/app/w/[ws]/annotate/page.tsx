import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { workspaceFor } from "@/lib/api";
import { listDatasets } from "@/lib/server/datasets";
export const metadata = { title: "Annotation" };
export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const u = await currentUser(); if (!u) redirect("/login");
  const { ws } = await params;
  const c = await workspaceFor(u, ws);
  const ds = await listDatasets(c.workspaceId);
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div><h1 className="text-lg font-semibold">Annotation</h1><p className="text-sm text-fg-muted">Pick a dataset to label or review. Labeling means telling the computer what is in each photo.</p></div>
      {ds.length === 0 ? <p className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-fg-subtle">No datasets yet. <Link className="text-accent underline" href={`/w/${ws}/datasets`}>Create one</Link> and upload images first.</p> :
        <ul className="divide-y divide-line rounded-lg border border-line">{ds.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3"><div><div className="font-medium">{d.name}</div><div className="text-xs text-fg-muted">{d.images - d.labeled} to label · {d.labeled - d.approved} to review · {d.approved} approved</div></div>
            <div className="flex gap-2">{d.images > 0 && <Link className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-fg" href={`/w/${ws}/datasets/${d.id}/annotate`}>Label</Link>}
              {d.labeled - d.approved > 0 && <Link className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] hover:bg-hover" href={`/w/${ws}/datasets/${d.id}/annotate?mode=review`}>Review</Link>}</div></li>))}</ul>}
    </div>
  );
}
