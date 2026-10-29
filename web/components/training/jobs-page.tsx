"use client";
import { useState } from "react";
import useSWR from "swr";
import { Download } from "lucide-react";
import { Alert, Badge, Button } from "@/components/ui/form";
import { api, fetcher } from "@/lib/client/api";
import { can, type Role } from "@/lib/authz";
import { StatusBadge, dur, isActive, useWorkers, when } from "./shared";

type Job = { id: string; kind: string; status: string; progress: number; message: string | null; error: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null; createdBy: string | null; result: Record<string, any> | null };
const KIND: Record<string, string> = { train: "Training", evaluate: "Evaluation", predict: "Prediction", export_dataset: "Dataset export" };

export function JobsPage({ slug, role }: { slug: string; role: Role }) {
  const { data: w } = useWorkers(slug);
  const { data, error, mutate } = useSWR<{ jobs: Job[] }>(`/api/w/${slug}/jobs`, fetcher, { refreshInterval: (d) => (d?.jobs.some((j) => isActive(j.status)) ? 3000 : 10000) });
  const [open, setOpen] = useState<string | null>(null);
  const { data: detail } = useSWR<{ logs: { id: number; line: string; at: string }[] }>(open ? `/api/w/${slug}/jobs/${open}` : null, fetcher, { refreshInterval: 3000 });
  const [err, setErr] = useState<string | null>(null);
  const canRun = can(role, "training.run");
  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div><h1 className="text-lg font-semibold">Jobs &amp; workers</h1><p className="text-sm text-fg-muted">Heavy work runs on a worker machine you control, never on the website. This page shows what is queued, running and finished.</p></div>
      <section aria-labelledby="w-h" className="space-y-2">
        <h2 id="w-h" className="text-sm font-semibold">Workers</h2>
        {w && w.workers.length === 0 && <Alert kind="warn">No worker has ever connected. Jobs stay queued until you start one — see the steps below.</Alert>}
        <ul className="grid gap-2 sm:grid-cols-2">{w?.workers.map((x) => (
          <li key={x.id} className="rounded-lg border border-line p-3 text-[13px]"><div className="flex items-center justify-between"><span className="font-medium">{x.name}</span><Badge tone={x.online ? "ok" : "neutral"}>{x.online ? "Online" : "Offline"}</Badge></div>
            <p className="text-xs text-fg-subtle">Last seen {when(x.lastSeen)}</p>
            <p className="mt-1 text-xs text-fg-muted">{[x.info.device, x.info.gpu, x.info.python && `Python ${x.info.python}`, x.info.torch && `PyTorch ${x.info.torch}`].filter(Boolean).join(" · ")}</p></li>))}</ul>
        <details className="rounded-lg border border-line p-3" open={w ? !w.online : false}>
          <summary className="cursor-pointer text-[13px] font-medium">How to start a worker</summary>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13px] text-fg-muted">
            <li>Use any computer with Python 3.10+. A GPU makes training much faster, but is not required.</li>
            <li>Get the <code className="rounded bg-muted px-1">worker/</code> folder of this project and run <code className="rounded bg-muted px-1">pip install -r requirements.txt</code> inside it.</li>
            <li>Copy <code className="rounded bg-muted px-1">worker/.env.worker.example</code> to <code className="rounded bg-muted px-1">.env.worker</code> and fill in the database and storage values your admin keeps in the private setup file. Never share that file.</li>
            <li>Run <code className="rounded bg-muted px-1">python -m wvworker check</code> to test the connection, then <code className="rounded bg-muted px-1">python -m wvworker run</code> and leave it open.</li>
            <li>This page shows the worker as <b>Online</b> within a minute. Queued jobs start automatically.</li>
          </ol>
        </details>
      </section>
      <section aria-labelledby="j-h" className="space-y-2">
        <h2 id="j-h" className="text-sm font-semibold">Recent jobs {w && <span className="font-normal text-fg-subtle">· {w.queued} queued, {w.running} running</span>}</h2>
        {error && <Alert>{(error as Error).message}</Alert>}{err && <Alert>{err}</Alert>}
        {data && data.jobs.length === 0 && <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-fg-subtle">No jobs yet.</p>}
        <ul className="space-y-2" data-testid="jobs">{data?.jobs.map((j) => (
          <li key={j.id} className="rounded-lg border border-line p-3 text-[13px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2"><b>{KIND[j.kind] ?? j.kind}</b><StatusBadge status={j.status} /><span className="text-xs text-fg-subtle">{when(j.createdAt)} · {j.createdBy ?? "system"} · {dur(j.startedAt, j.finishedAt)}</span></span>
              <span className="flex gap-1.5">
                {j.kind === "export_dataset" && j.status === "completed" && <a href={`/api/w/${slug}/jobs/${j.id}/download`}><Button size="sm"><Download size={13} />Download zip</Button></a>}
                <Button size="sm" onClick={() => setOpen(open === j.id ? null : j.id)}>{open === j.id ? "Hide log" : "Log"}</Button>
                {canRun && isActive(j.status) && <Button size="sm" onClick={async () => { setErr(null); try { await api(`/api/w/${slug}/jobs/${j.id}/cancel`, { method: "POST", body: {} }); mutate(); } catch (e) { setErr((e as Error).message); } }}>Cancel</Button>}
              </span>
            </div>
            {isActive(j.status) && <div className="mt-2"><div className="mb-0.5 text-xs text-fg-muted">{j.message ?? (j.status === "queued" ? "Waiting for a worker…" : "Working…")}</div><div className="h-1.5 overflow-hidden rounded bg-muted"><div className="h-full bg-accent" style={{ width: `${Math.max(2, j.progress * 100)}%` }} /></div></div>}
            {j.error && <p className="mt-1.5 text-xs text-danger">{j.error}</p>}
            {open === j.id && <pre tabIndex={0} className="mt-2 max-h-60 overflow-auto rounded bg-subtle p-2 font-mono text-xs">{detail?.logs.length ? detail.logs.map((l) => `${new Date(l.at).toLocaleTimeString()}  ${l.line}`).join("\n") : "No log lines."}</pre>}
          </li>))}</ul>
      </section>
    </div>
  );
}
