"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge, Button, Field, Input, Textarea } from "@/components/ui/form";
import { api, fetcher } from "@/lib/client/api";
import { can, type Role } from "@/lib/authz";
import { cn } from "@/lib/cn";

type Row = { id: string; name: string; description: string; taskType: "detect" | "classify"; images: number; labeled: number; approved: number; versions: number };

export function DatasetsPage({ slug, role }: { slug: string; role: Role }) {
  const { data, error, mutate } = useSWR<{ datasets: Row[] }>(`/api/w/${slug}/datasets`, fetcher);
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-lg font-semibold">Datasets</h1><p className="text-sm text-fg-muted">Image collections your team labels and trains on.</p></div>
        {can(role, "datasets.create") && <Button variant="primary" onClick={() => setOpen(true)}><Plus size={14} />New dataset</Button>}
      </div>
      {error && <Alert>{(error as Error).message}</Alert>}
      {data && data.datasets.length === 0 && (
        <div className="rounded-lg border border-dashed border-line p-8 text-center">
          <h2 className="text-base font-semibold">No datasets yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">A dataset is a set of photos plus the labels that say what is in them. Start with one for the waste items your sorter must recognise.</p>
          {can(role, "datasets.create") ? <Button className="mt-4" variant="primary" onClick={() => setOpen(true)}>Create the first dataset</Button> : <p className="mt-3 text-xs text-fg-subtle">Ask an ML Engineer or admin to create one.</p>}
        </div>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {data?.datasets.map((d) => (
          <li key={d.id}><Link href={`/w/${slug}/datasets/${d.id}`} className="block rounded-lg border border-line p-4 hover:bg-hover">
            <div className="flex items-start justify-between gap-2"><h2 className="font-medium">{d.name}</h2><Badge tone="accent">{d.taskType === "detect" ? "Object detection" : "Classification"}</Badge></div>
            {d.description && <p className="mt-0.5 line-clamp-2 text-[13px] text-fg-muted">{d.description}</p>}
            <dl className="mt-3 grid grid-cols-4 gap-2 text-xs"><div><dt className="text-fg-subtle">Images</dt><dd className="text-sm font-medium">{d.images}</dd></div><div><dt className="text-fg-subtle">Labeled</dt><dd className="text-sm font-medium">{d.labeled}</dd></div><div><dt className="text-fg-subtle">Approved</dt><dd className="text-sm font-medium">{d.approved}</dd></div><div><dt className="text-fg-subtle">Versions</dt><dd className="text-sm font-medium">{d.versions}</dd></div></dl>
            {d.images > 0 && <div className="mt-2 h-1.5 overflow-hidden rounded bg-muted" role="img" aria-label={`${Math.round((d.labeled / d.images) * 100)}% labeled`}><div className="h-full bg-accent" style={{ width: `${(d.labeled / d.images) * 100}%` }} /></div>}
          </Link></li>
        ))}
      </ul>
      <CreateDialog slug={slug} open={open} onClose={() => setOpen(false)} onCreated={() => mutate()} />
    </div>
  );
}

function CreateDialog({ slug, open, onClose, onCreated }: { slug: string; open: boolean; onClose: () => void; onCreated: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(""); const [desc, setDesc] = useState(""); const [type, setType] = useState<"detect" | "classify">("detect");
  const [classes, setClasses] = useState("plastic, paper, metal, screw, e_waste"); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title="New dataset" wide>
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr(null);
        try { const r = await api<{ id: string }>(`/api/w/${slug}/datasets`, { body: { name, description: desc, taskType: type, classes: classes.split(",").map((c) => c.trim()).filter(Boolean) } }); onCreated(); router.push(`/w/${slug}/datasets/${r.id}`); }
        catch (e2) { setErr((e2 as Error).message); setBusy(false); }
      }}>
        {err && <Alert>{err}</Alert>}
        <Field label="Name" htmlFor="d-name"><Input id="d-name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Conveyor belt v1" /></Field>
        <fieldset>
          <legend className="mb-1 text-[13px] font-medium">What should the model learn?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {([["detect", "Object detection", "Finds each item and draws a box around it, with a class. Needed to know where a bottle or screw is on the belt."], ["classify", "Image classification", "Gives one label for the whole picture. Cannot tell where items are or count several items in one photo."]] as const).map(([v, t, d]) => (
              <label key={v} className={cn("cursor-pointer rounded-lg border p-3", type === v ? "border-accent bg-accent-soft" : "border-line hover:bg-hover")}>
                <input type="radio" name="type" className="sr-only" checked={type === v} onChange={() => setType(v)} /><span className="text-sm font-medium">{t}</span><span className="mt-0.5 block text-xs text-fg-muted">{d}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Classes" htmlFor="d-classes" hint="Comma-separated. You can add more later, but existing classes keep their order."><Input id="d-classes" value={classes} onChange={(e) => setClasses(e.target.value)} /></Field>
        <Field label="Description (optional)" htmlFor="d-desc"><Textarea id="d-desc" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={busy || name.trim().length < 2}>Create dataset</Button></div>
      </form>
    </Dialog>
  );
}
