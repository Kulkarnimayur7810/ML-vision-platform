"use client";
import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Download } from "lucide-react";
import { Alert, Badge, Button } from "@/components/ui/form";
import { Dialog } from "@/components/ui/dialog";
import { api, fetcher, ApiError } from "@/lib/client/api";
import { can, type Role } from "@/lib/authz";
import { pct, when } from "@/components/training/shared";

type Model = { id: string; name: string; number: number; stage: "candidate" | "selected" | "archived"; notes: string; taskType: string; arch: string; sizeBytes: number; sha256: string; classes: string[]; runId: string; runNumber: number | null;
  datasetName: string | null; versionNumber: number | null; bestMetrics: Record<string, any> | null; testMetrics: Record<string, any> | null; createdAt: string; createdBy: string | null };
const TONE = { selected: "ok", candidate: "neutral", archived: "warn" } as const;
const HEAD = (m: Model) => (m.taskType === "detect" ? { v: pct(m.bestMetrics?.["metrics/mAP50(B)"]), t: pct(m.testMetrics?.map50), l: "mAP@50" } : { v: pct(m.bestMetrics?.["metrics/accuracy_top1"]), t: pct(m.testMetrics?.top1), l: "top-1" });

export function ModelsPage({ slug, role }: { slug: string; role: Role }) {
  const { data, error, mutate } = useSWR<{ models: Model[] }>(`/api/w/${slug}/models`, fetcher);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ m: Model; current: number } | null>(null);
  const manage = can(role, "models.manage");
  const groups = new Map<string, Model[]>();
  for (const m of data?.models ?? []) groups.set(m.name, [...(groups.get(m.name) ?? []), m]);
  async function setStage(m: Model, stage: Model["stage"], confirmReplace = false) {
    setErr(null);
    try { await api(`/api/w/${slug}/models/${m.id}`, { method: "PATCH", body: { stage, confirmReplace } }); setConfirm(null); await mutate(); }
    catch (e) { if (e instanceof ApiError && e.data?.needsConfirm) setConfirm({ m, current: Number(e.data.currentSelected) }); else setErr((e as Error).message); }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div><h1 className="text-lg font-semibold">Models</h1><p className="text-sm text-fg-muted">A registry of trained models worth keeping. Each registered version is a fixed snapshot of a training run's best checkpoint — it is never overwritten.</p></div>
      {error && <Alert>{(error as Error).message}</Alert>}{err && <Alert>{err}</Alert>}
      {data && data.models.length === 0 && (
        <div className="rounded-lg border border-dashed border-line p-8 text-center"><h2 className="text-base font-semibold">No registered models</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">Finish a training run, check its test evaluation, then use “Register as model” on the run page.</p>
          <Link href={`/w/${slug}/training`}><Button className="mt-4">Go to Training</Button></Link></div>
      )}
      {[...groups].map(([name, list]) => (
        <section key={name} aria-label={name} className="space-y-2"><h2 className="text-sm font-semibold">{name}</h2>
          <ul className="space-y-2">{list.map((m) => { const h = HEAD(m); return (
            <li key={m.id} className="rounded-lg border border-line p-3 text-[13px]" data-testid="model">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2"><b>v{m.number}</b><Badge tone={TONE[m.stage]}>{m.stage === "selected" ? "Selected" : m.stage === "candidate" ? "Candidate" : "Archived"}</Badge><span className="text-fg-subtle">{m.arch} · {(m.sizeBytes / 1e6).toFixed(1)} MB</span></span>
                <span className="flex flex-wrap gap-1.5">
                  <a href={`/api/w/${slug}/models/${m.id}/download`}><Button size="sm"><Download size={13} />Download .pt</Button></a>
                  {manage && m.stage !== "selected" && m.stage !== "archived" && <Button size="sm" variant="primary" onClick={() => setStage(m, "selected")}>Select for use</Button>}
                  {manage && m.stage === "selected" && <Button size="sm" onClick={() => setStage(m, "candidate")}>Unselect</Button>}
                  {manage && m.stage !== "archived" && <Button size="sm" onClick={() => setStage(m, "archived")}>Archive</Button>}
                  {manage && m.stage === "archived" && <Button size="sm" onClick={() => setStage(m, "candidate")}>Restore</Button>}
                </span>
              </div>
              <p className="mt-1 text-fg-muted">From <Link className="underline" href={`/w/${slug}/training/${m.runId}`}>run #{m.runNumber}</Link> · {m.datasetName} v{m.versionNumber} · {when(m.createdAt)} · {m.createdBy}</p>
              <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div><dt className="text-xs text-fg-subtle">{h.l} · validation</dt><dd className="font-medium">{h.v}</dd></div>
                <div><dt className="text-xs text-fg-subtle">{h.l} · test split</dt><dd className="font-medium">{m.testMetrics ? h.t : <span className="text-fg-subtle">not evaluated</span>}</dd></div>
                <div className="col-span-2"><dt className="text-xs text-fg-subtle">Classes</dt><dd>{m.classes.join(", ") || "—"}</dd></div>
              </dl>
              {m.notes && <p className="mt-1.5 whitespace-pre-wrap text-fg-muted">{m.notes}</p>}
            </li>); })}</ul></section>
      ))}
      <p className="text-xs text-fg-subtle">Serving a model to a sorter, or deploying it to hardware, is not built into this app — download the .pt file and use it with Ultralytics on your device.</p>
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} title="Replace the selected version?">
        {confirm && <div className="space-y-3 text-sm"><p>{confirm.m.name} v{confirm.current} is currently selected. Selecting v{confirm.m.number} moves it back to <b>Candidate</b>. Nothing is deleted.</p>
          <div className="flex justify-end gap-2"><Button onClick={() => setConfirm(null)}>Cancel</Button><Button variant="primary" onClick={() => setStage(confirm.m, "selected", true)}>Replace</Button></div></div>}
      </Dialog>
    </div>
  );
}
