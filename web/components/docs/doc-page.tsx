"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Archive, Link2, Pencil, X } from "lucide-react";
import { Alert, Badge, Button, Input, Select } from "@/components/ui/form";
import { api, fetcher } from "@/lib/client/api";
import { can, type Role } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { when } from "@/components/training/shared";
import { Markdown } from "./markdown";

type LinkItem = { type: string; id: string; title: string; href: string | null };
type Doc = { id: string; title: string; body: string; version: number; updatedAt: string; updatedBy: string | null; createdBy: string | null; links: LinkItem[] };
const TYPE: Record<string, string> = { task: "Task", dataset: "Dataset", run: "Training run", model: "Model" };

export function DocPage({ slug, id, role }: { slug: string; id: string; role: Role }) {
  const router = useRouter(); const sp = useSearchParams();
  const { data, error, mutate } = useSWR<Doc>(`/api/w/${slug}/docs/${id}`, fetcher, { revalidateOnFocus: false });
  const canEdit = can(role, "docs.edit");
  const [editing, setEditing] = useState(sp.get("edit") === "1" && canEdit);
  const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [links, setLinks] = useState<LinkItem[]>([]);
  const [version, setVersion] = useState(1); const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => { if (data && loaded !== data.id) { setTitle(data.title); setBody(data.body); setLinks(data.links); setVersion(data.version); setLoaded(data.id); } }, [data, loaded]);
  useEffect(() => { if (!dirty) return; const h = (e: BeforeUnloadEvent) => { e.preventDefault(); }; window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h); }, [dirty]);

  const save = useCallback(async () => {
    if (busy || !dirty) return; setBusy(true); setErr(null);
    try { const r = await api<{ version: number }>(`/api/w/${slug}/docs/${id}`, { method: "PATCH", body: { version, title, body, links: links.map((l) => ({ type: l.type, id: l.id })) } }); setVersion(r.version); setDirty(false); setSaved(true); await mutate(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }, [busy, dirty, slug, id, version, title, body, links, mutate]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "s" && editing) { e.preventDefault(); void save(); } }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [editing, save]);

  if (error) return <div className="p-6"><Alert>{(error as Error).message}</Alert></div>;
  if (!data || loaded !== data.id) return <div className="p-6 text-sm text-fg-subtle">Loading…</div>;
  const edit = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setDirty(true); setSaved(false); };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1"><p className="text-xs text-fg-subtle"><Link className="hover:underline" href={`/w/${slug}/docs`}>Documentation</Link></p>
          {editing ? <Input aria-label="Title" className="mt-1 h-10 text-lg font-semibold" value={title} maxLength={160} onChange={(e) => edit(setTitle)(e.target.value)} /> : <h1 className="text-xl font-semibold">{data.title}</h1>}
          <p className="mt-1 text-xs text-fg-subtle">Last edited {when(data.updatedAt)} by {data.updatedBy ?? "—"}</p></div>
        {canEdit && <div className="flex items-center gap-2">
          {editing && <span className="text-xs text-fg-muted" data-testid="doc-state" aria-live="polite">{busy ? "Saving…" : dirty ? "Unsaved changes" : saved ? "All changes saved" : ""}</span>}
          {editing ? <><Button variant="primary" disabled={busy || !dirty} onClick={save}>Save</Button><Button disabled={busy} onClick={() => { if (dirty && !confirm("Discard unsaved changes?")) return; setEditing(false); setDirty(false); router.replace(`/w/${slug}/docs/${id}`); setTitle(data.title); setBody(data.body); setLinks(data.links); setVersion(data.version); }}>Done</Button></>
            : <Button onClick={() => setEditing(true)}><Pencil size={13} />Edit</Button>}
        </div>}
      </div>
      {err && <Alert>{err}</Alert>}

      {editing ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="tablist" aria-label="Editor view" className="flex gap-1 lg:hidden">{(["write", "preview"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("cursor-pointer rounded-md px-2.5 py-1 text-xs", tab === t ? "bg-accent text-accent-fg" : "bg-muted")}>{t === "write" ? "Write" : "Preview"}</button>)}</div>
            <InsertRun slug={slug} onInsert={(md) => { edit(setBody)(body + (body.endsWith("\n") || !body ? "" : "\n\n") + md); }} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={cn(tab === "preview" && "hidden lg:block")}><label htmlFor="doc-body" className="sr-only">Document text (Markdown)</label>
              <textarea id="doc-body" value={body} onChange={(e) => edit(setBody)(e.target.value)} spellCheck className="h-[60vh] w-full resize-y rounded-lg border border-line-strong bg-bg p-3 font-mono text-[13px] leading-relaxed" />
              <p className="mt-1 text-xs text-fg-subtle">Markdown: # headings, **bold**, - lists, - [ ] checkboxes, | tables |. Ctrl/⌘+S saves.</p></div>
            <div className={cn("min-h-40 rounded-lg border border-line p-4", tab === "write" && "hidden lg:block")} aria-label="Preview"><Markdown>{body || "*Nothing yet.*"}</Markdown></div>
          </div>
        </div>
      ) : <article className="rounded-lg border border-line p-5" data-testid="doc-body"><Markdown>{data.body || "*This document is empty.*"}</Markdown></article>}

      <section aria-labelledby="lk-h" className="space-y-2">
        <h2 id="lk-h" className="flex items-center gap-1.5 text-sm font-semibold"><Link2 size={14} />Linked work</h2>
        {links.length === 0 && <p className="text-[13px] text-fg-subtle">Nothing linked yet.</p>}
        <ul className="flex flex-wrap gap-2">{links.map((l) => <li key={l.type + l.id} className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[13px]"><Badge tone="neutral">{TYPE[l.type]}</Badge>{l.href ? <Link className="hover:underline" href={l.href}>{l.title}</Link> : l.title}{editing && <button aria-label={`Remove link to ${l.title}`} className="cursor-pointer text-fg-subtle hover:text-fg" onClick={() => { setLinks(links.filter((x) => x !== l)); setDirty(true); setSaved(false); }}><X size={12} /></button>}</li>)}</ul>
        {editing && <AddLink slug={slug} onAdd={(l) => { if (!links.some((x) => x.type === l.type && x.id === l.id)) { setLinks([...links, l]); setDirty(true); setSaved(false); } }} />}
      </section>

      {canEdit && <div className="border-t border-line pt-3"><Button size="sm" onClick={async () => { if (!confirm("Archive this document? It disappears from the list but is kept in the database.")) return; try { await api(`/api/w/${slug}/docs/${id}`, { method: "DELETE" }); router.push(`/w/${slug}/docs`); } catch (e) { setErr((e as Error).message); } }}><Archive size={13} />Archive document</Button></div>}
    </div>
  );
}

function InsertRun({ slug, onInsert }: { slug: string; onInsert: (md: string) => void }) {
  const { data } = useSWR<{ runs: { id: string; number: number; name: string; status: string }[] }>(`/api/w/${slug}/runs`, fetcher);
  const [id, setId] = useState(""); const [err, setErr] = useState<string | null>(null);
  const runs = data?.runs ?? [];
  if (runs.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5">
      <label className="sr-only" htmlFor="ins-run">Run to insert results from</label>
      <Select id="ins-run" className="max-w-56" value={id} onChange={(e) => setId(e.target.value)}><option value="">Insert run results…</option>{runs.map((r) => <option key={r.id} value={r.id}>#{r.number} {r.name} ({r.status})</option>)}</Select>
      <Button size="sm" disabled={!id} onClick={async () => { setErr(null); try { onInsert((await api<{ markdown: string }>(`/api/w/${slug}/runs/${id}/snapshot`)).markdown); setId(""); } catch (e) { setErr((e as Error).message); } }}>Insert</Button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </div>
  );
}

function AddLink({ slug, onAdd }: { slug: string; onAdd: (l: LinkItem) => void }) {
  const [type, setType] = useState<"dataset" | "run" | "model" | "task">("dataset"); const [pick, setPick] = useState(""); const [err, setErr] = useState<string | null>(null);
  const { data: ds } = useSWR<{ datasets: { id: string; name: string }[] }>(type === "dataset" ? `/api/w/${slug}/datasets` : null, fetcher);
  const { data: rs } = useSWR<{ runs: { id: string; number: number; name: string }[] }>(type === "run" ? `/api/w/${slug}/runs` : null, fetcher);
  const { data: ms } = useSWR<{ models: { id: string; name: string; number: number }[] }>(type === "model" ? `/api/w/${slug}/models` : null, fetcher);
  const opts: { id: string; title: string; href: string }[] = type === "dataset" ? (ds?.datasets ?? []).map((d) => ({ id: d.id, title: d.name, href: `/w/${slug}/datasets/${d.id}` })) : type === "run" ? (rs?.runs ?? []).map((r) => ({ id: r.id, title: `Run #${r.number} ${r.name}`, href: `/w/${slug}/training/${r.id}` })) : type === "model" ? (ms?.models ?? []).map((m) => ({ id: m.id, title: `${m.name} v${m.number}`, href: `/w/${slug}/models` })) : [];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="lk-type">Link type</label>
      <Select id="lk-type" className="w-36" value={type} onChange={(e) => { setType(e.target.value as typeof type); setPick(""); }}><option value="dataset">Dataset</option><option value="run">Training run</option><option value="model">Model</option><option value="task">Task by number</option></Select>
      {type === "task" ? <Input aria-label="Task number" className="w-28" inputMode="numeric" placeholder="e.g. 12" value={pick} onChange={(e) => setPick(e.target.value.replace(/\D/g, ""))} />
        : <><label className="sr-only" htmlFor="lk-pick">Item to link</label><Select id="lk-pick" className="w-56" value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Choose…</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</Select></>}
      <Button size="sm" disabled={!pick} onClick={async () => {
        setErr(null);
        if (type === "task") { try { const t = (await api<{ task: { id: string; number: number; title: string } }>(`/api/w/${slug}/tasks/by-number/${pick}`)).task; onAdd({ type: "task", id: t.id, title: `#${t.number} ${t.title}`, href: `/w/${slug}/kanban/tasks/${t.number}` }); setPick(""); } catch { setErr("No task with that number."); } return; }
        const o = opts.find((x) => x.id === pick); if (o) { onAdd({ type, id: o.id, title: o.title, href: o.href }); setPick(""); }
      }}>Add link</Button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </div>
  );
}
