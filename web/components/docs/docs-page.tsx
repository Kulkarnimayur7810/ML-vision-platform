"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { FileText, Plus, Search } from "lucide-react";
import { Alert, Badge, Button, Input } from "@/components/ui/form";
import { Dialog } from "@/components/ui/dialog";
import { api, fetcher } from "@/lib/client/api";
import { TEMPLATES } from "@/lib/docs-templates";
import { can, type Role } from "@/lib/authz";
import { when } from "@/components/training/shared";

type Doc = { id: string; title: string; kind: string; updatedAt: string; updatedBy: string | null; snippet: string | null };
const KIND: Record<string, string> = { blank: "Page", meeting: "Meeting", collection: "Data collection", labeling: "Labeling", experiment: "Experiment", model_card: "Model card", report: "Report" };

export function DocsPage({ slug, role }: { slug: string; role: Role }) {
  const router = useRouter();
  const [q, setQ] = useState(""); const [dq, setDq] = useState("");
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  const { data, error } = useSWR<{ docs: Doc[] }>(`/api/w/${slug}/docs${dq ? `?q=${encodeURIComponent(dq)}` : ""}`, fetcher);
  const [open, setOpen] = useState(false); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function create(kind: string) {
    if (busy) return; setBusy(true); setErr(null);
    try { const r = await api<{ id: string }>(`/api/w/${slug}/docs`, { body: { kind } }); router.push(`/w/${slug}/docs/${r.id}?edit=1`); } catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-lg font-semibold">Documentation</h1><p className="text-sm text-fg-muted">Protocols, guidelines, experiment write-ups and report sections — next to the work they describe.</p></div>
        {can(role, "docs.edit") && <Button variant="primary" onClick={() => setOpen(true)}><Plus size={14} />New document</Button>}
      </div>
      <div className="relative"><Search size={14} className="absolute left-2.5 top-2.5 text-fg-subtle" /><Input aria-label="Search documents" className="pl-8" placeholder="Search titles and text…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {error && <Alert>{(error as Error).message}</Alert>}{err && <Alert>{err}</Alert>}
      {data && data.docs.length === 0 && (
        <div className="rounded-lg border border-dashed border-line p-8 text-center"><h2 className="text-base font-semibold">{dq ? "No matching documents" : "No documents yet"}</h2>
          {!dq && <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">Start from a template such as a data collection protocol or labeling guidelines, so everyone works the same way.</p>}</div>
      )}
      <ul className="divide-y divide-line rounded-lg border border-line empty:hidden" data-testid="docs">
        {data?.docs.map((d) => (
          <li key={d.id}><Link href={`/w/${slug}/docs/${d.id}`} className="flex items-start gap-3 p-3 hover:bg-hover">
            <FileText size={16} className="mt-0.5 shrink-0 text-fg-subtle" />
            <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 font-medium">{d.title}<Badge tone="neutral">{KIND[d.kind] ?? d.kind}</Badge></span>
              {d.snippet && <span className="mt-0.5 block truncate text-xs text-fg-muted">…{d.snippet.replace(/\s+/g, " ")}…</span>}
              <span className="text-xs text-fg-subtle">Updated {when(d.updatedAt)} · {d.updatedBy}</span></span>
          </Link></li>))}
      </ul>
      <Dialog open={open} onClose={() => setOpen(false)} title="New document" wide>
        <div className="grid gap-2 sm:grid-cols-2">{TEMPLATES.map((t) => (
          <button key={t.kind} disabled={busy} onClick={() => create(t.kind)} className="cursor-pointer rounded-lg border border-line p-3 text-left hover:bg-hover disabled:opacity-60"><span className="block text-sm font-medium">{t.label}</span><span className="block text-xs text-fg-muted">{t.help}</span></button>))}</div>
      </Dialog>
    </div>
  );
}
