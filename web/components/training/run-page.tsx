"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Download, PackagePlus, RotateCcw, Square } from "lucide-react";
import { Alert, Badge, Button, Field, Input, Textarea } from "@/components/ui/form";
import { Dialog } from "@/components/ui/dialog";
import { api, fetcher } from "@/lib/client/api";
import { can, type Role } from "@/lib/authz";
import { EPOCH_KEY, EPOCH_LABEL, EVAL_METRICS, LineChart, MetricTile, SPLIT_LABEL, StatusBadge, WorkerBanner, dur, isActive, num, pct, when, type TaskType } from "./shared";

export type Eval = {
  id: string; split: "train" | "val" | "test"; status: string; metrics: Record<string, any> | null; perClass: Record<string, any>[] | null;
  confusion: { labels: string[]; matrix: number[][] } | null; speed: Record<string, any> | null; nImages: number | null; createdAt: string; finishedAt: string | null;
};
type Run = {
  id: string; number: number; name: string; status: string; taskType: TaskType; arch: string; pretrained: boolean; config: Record<string, any>; datasetId: string; datasetName: string; versionNumber: number;
  jobId: string | null; epochsDone: number; bestMetrics: Record<string, any> | null; device: string | null; artifacts: Record<string, { bytes: number; sha256: string }>; error: string | null;
  startedAt: string | null; finishedAt: string | null; createdAt: string; progress: number | null; message: string | null; createdBy: string | null;
  epochs: { epoch: number; val: Record<string, number | null>; train_loss: Record<string, number | null> }[]; evaluations: Eval[]; models: { id: string; name: string; number: number; stage: string }[];
};

function useJobLogs(slug: string, jobId: string | null, active: boolean) {
  const [lines, setLines] = useState<{ id: number; at: string; line: string }[]>([]);
  const last = useRef(0);
  const load = useCallback(async () => {
    if (!jobId) return;
    try {
      const j = await api<{ logs: { id: number; at: string; line: string }[] }>(`/api/w/${slug}/jobs/${jobId}?after=${last.current}`);
      if (j.logs.length) { last.current = j.logs[j.logs.length - 1].id; setLines((l) => [...l, ...j.logs].slice(-1000)); }
    } catch { /* transient */ }
  }, [slug, jobId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!active) { void load(); return; } const t = setInterval(load, 3000); return () => clearInterval(t); }, [active, load]);
  return lines;
}

export function RunPage({ slug, id, role }: { slug: string; id: string; role: Role }) {
  const { data: run, error, mutate } = useSWR<Run>(`/api/w/${slug}/runs/${id}`, fetcher, { refreshInterval: (d) => (d && (isActive(d.status) || d.evaluations.some((e) => isActive(e.status))) ? 3000 : 0) });
  const active = !!run && isActive(run.status);
  const lines = useJobLogs(slug, run?.jobId ?? null, active || !!run?.evaluations.some((e) => isActive(e.status)));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const canRun = can(role, "training.run");
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [lines.length]);
  if (error) return <div className="p-6"><Alert>{(error as Error).message}</Alert></div>;
  if (!run) return <div className="p-6 text-sm text-fg-subtle">Loading…</div>;
  const metricKey = EPOCH_KEY[run.taskType];
  const act = async (path: string, then?: (r: any) => void) => { setBusy(true); setErr(null); try { const r = await api(`/api/w/${slug}/runs/${id}/${path}`, { method: "POST", body: {} }); then?.(r); await mutate(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const lossNames = Array.from(new Set(run.epochs.flatMap((e) => Object.keys(e.train_loss ?? {}))));
  const colors = ["#2f6f4e", "#c2410c", "#2563eb", "#9333ea"];
  const best = run.bestMetrics;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-fg-subtle"><Link className="hover:underline" href={`/w/${slug}/training`}>Training</Link> / Run #{run.number}</p>
          <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold">{run.name}<StatusBadge status={run.status} /></h1>
          <p className="text-sm text-fg-muted">{run.datasetName} v{run.versionNumber} · {run.arch}{run.pretrained ? " (pretrained)" : " (from scratch)"} · {run.taskType === "detect" ? "object detection" : "classification"}</p>
        </div>
        {canRun && <div className="flex gap-2">
          {active && <Button disabled={busy} onClick={() => act("cancel")}><Square size={13} />Cancel run</Button>}
          {["failed", "cancelled", "interrupted"].includes(run.status) && <Button disabled={busy} onClick={() => act("retry", (r) => { window.location.href = `/w/${slug}/training/${r.id}`; })}><RotateCcw size={13} />Retry with same settings</Button>}
        </div>}
      </div>
      {err && <Alert>{err}</Alert>}
      {active && <WorkerBanner slug={slug} />}
      {active && (
        <div className="rounded-lg border border-line p-3" data-testid="progress">
          <div className="mb-1 flex justify-between text-xs"><span>{run.message ?? (run.status === "queued" ? "Waiting for a worker…" : "Working…")}</span><span className="tabular-nums">{run.epochsDone}/{run.config.epochs} epochs</span></div>
          <div className="h-2 overflow-hidden rounded bg-muted" role="progressbar" aria-valuenow={Math.round((run.progress ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-accent transition-all" style={{ width: `${Math.max(2, (run.progress ?? 0) * 100)}%` }} /></div>
        </div>
      )}
      {run.status === "failed" && <Alert>Training failed: {run.error ?? "unknown error"}. The log below has details.</Alert>}
      {run.status === "interrupted" && <Alert kind="warn">The worker stopped responding, so this run did not finish. Nothing here was marked as completed. Start the worker again and use “Retry with same settings”.</Alert>}
      {run.status === "cancelled" && <Alert kind="info">This run was cancelled. {run.epochsDone > 0 ? `${run.epochsDone} epoch(s) were recorded.` : ""}</Alert>}

      {best && (
        <section aria-labelledby="best-h" className="space-y-2">
          <h2 id="best-h" className="text-sm font-semibold">Best validation result <Badge tone="neutral">{SPLIT_LABEL.val} · epoch {best.epoch}</Badge></h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {run.taskType === "detect" ? <>
              <MetricTile label="Precision" value={pct(best["metrics/precision(B)"])} /><MetricTile label="Recall" value={pct(best["metrics/recall(B)"])} /><MetricTile label="mAP@50" value={pct(best["metrics/mAP50(B)"])} /><MetricTile label="mAP@50-95" value={pct(best["metrics/mAP50-95(B)"])} />
            </> : <><MetricTile label="Top-1 accuracy" value={pct(best["metrics/accuracy_top1"])} /><MetricTile label="Top-5 accuracy" value={pct(best["metrics/accuracy_top5"])} /></>}
          </div>
          <p className="text-xs text-fg-muted">These come from the validation images the model was tuned against while training, so they are optimistic. For an honest final number, run a test-split evaluation below.</p>
        </section>
      )}

      <section className="grid gap-3 md:grid-cols-2" aria-label="Training curves">
        <LineChart title="Training loss" series={lossNames.map((n, i) => ({ name: n, color: colors[i % colors.length], points: run.epochs.filter((e) => e.train_loss?.[n] != null).map((e) => ({ x: e.epoch, y: e.train_loss[n] as number })) }))} />
        <LineChart title={EPOCH_LABEL[run.taskType]} yMin={0} yFormat={(v) => pct(v, 0)} series={[{ name: "validation", color: colors[0], points: run.epochs.filter((e) => e.val?.[metricKey] != null).map((e) => ({ x: e.epoch, y: e.val[metricKey] as number })) }]} />
      </section>

      <section className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-line p-3 text-[13px] sm:grid-cols-4" aria-label="Run details">
        {[["Started", when(run.startedAt)], ["Duration", dur(run.startedAt, run.finishedAt)], ["Device", run.device ?? "—"], ["Started by", run.createdBy ?? "—"], ["Epochs", `${run.epochsDone}/${run.config.epochs}`], ["Image size", `${run.config.imgsz}px`], ["Batch", String(run.config.batch)], ["Learning rate", String(run.config.lr0)]].map(([k, v]) => <div key={k}><dt className="text-xs text-fg-subtle">{k}</dt><dd className="font-medium">{v}</dd></div>)}
      </section>

      {Object.keys(run.artifacts).length > 0 && (
        <section aria-labelledby="ck-h"><h2 id="ck-h" className="mb-2 text-sm font-semibold">Checkpoints</h2>
          <ul className="space-y-1.5">{(["best", "last"] as const).filter((k) => run.artifacts[k]).map((k) => (
            <li key={k} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-2.5 text-[13px]">
              <span><b>{k}.pt</b> <span className="text-fg-subtle">{(run.artifacts[k].bytes / 1e6).toFixed(1)} MB · sha256 {run.artifacts[k].sha256.slice(0, 12)}…</span> <span className="text-xs text-fg-muted">{k === "best" ? "highest validation score" : "final epoch"}</span></span>
              <a href={`/api/w/${slug}/runs/${id}/artifact?which=${k}`} download><Button size="sm"><Download size={13} />Download</Button></a>
            </li>))}</ul>
        </section>
      )}

      {run.status === "completed" && run.artifacts.best && <RegisterSection slug={slug} run={run} canManage={can(role, "models.manage")} reload={() => mutate()} />}
      {run.status === "completed" && <EvalSection slug={slug} run={run} canRun={canRun} reload={() => mutate()} />}

      <section aria-labelledby="log-h"><h2 id="log-h" className="mb-2 text-sm font-semibold">Worker log</h2>
        <pre ref={logRef} tabIndex={0} className="max-h-72 overflow-auto rounded-lg border border-line bg-subtle p-3 font-mono text-xs leading-relaxed" data-testid="log">{lines.length ? lines.map((l) => `${new Date(l.at).toLocaleTimeString()}  ${l.line}`).join("\n") : "No log lines yet. They appear once a worker picks the job up."}</pre>
      </section>
    </div>
  );
}

function EvalSection({ slug, run, canRun, reload }: { slug: string; run: Run; canRun: boolean; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<string | null>(null);
  const start = async (split: "val" | "test") => { setBusy(split); setErr(null); try { await api(`/api/w/${slug}/runs/${run.id}/evaluations`, { body: { split } }); reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); } };
  const shown = run.evaluations.find((e) => e.id === view) ?? run.evaluations.find((e) => e.status === "completed") ?? run.evaluations[0];
  return (
    <section aria-labelledby="ev-h" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ev-h" className="text-sm font-semibold">Evaluation</h2>
        {canRun && <div className="flex gap-2"><Button size="sm" disabled={!!busy} onClick={() => start("val")}>Evaluate on validation</Button><Button size="sm" variant="primary" disabled={!!busy} onClick={() => start("test")}>Evaluate on test (final)</Button></div>}
      </div>
      <p className="text-xs text-fg-muted">Every result is labelled with the split it was measured on. Validation images guided training, so only the <b>test</b> split — images the model never saw — gives an honest estimate. Avoid tuning against the test split repeatedly.</p>
      {err && <Alert>{err}</Alert>}
      {run.evaluations.length === 0 && <p className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-fg-subtle">No evaluations yet.</p>}
      {run.evaluations.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Evaluations">
          {run.evaluations.map((e) => <button key={e.id} role="tab" aria-selected={shown?.id === e.id} onClick={() => setView(e.id)} className={`cursor-pointer rounded-md border px-2.5 py-1 text-xs ${shown?.id === e.id ? "border-accent bg-accent-soft" : "border-line hover:bg-hover"}`}>{SPLIT_LABEL[e.split]} · {when(e.createdAt)} · {e.status}</button>)}
        </div>
      )}
      {shown && <EvalView e={shown} task={run.taskType} slug={slug} />}
    </section>
  );
}

export function EvalView({ e, task, slug }: { e: Eval; task: TaskType; slug: string }) {
  if (e.status !== "completed" || !e.metrics) return <Alert kind={e.status === "failed" ? "error" : "info"}>{e.status === "failed" ? "This evaluation failed. See the Jobs page for the log." : e.status === "interrupted" ? "This evaluation was interrupted when the worker stopped." : `Evaluation ${e.status}…`}</Alert>;
  const m = e.metrics;
  const errs: { imageId: string; fp?: number; fn?: number; truth?: string; predicted?: string }[] = m.errorAnalysis?.images ?? m.misclassified ?? [];
  const cm = e.confusion;
  const max = cm ? Math.max(1, ...cm.matrix.flat()) : 1;
  return (
    <div className="space-y-3" data-testid="eval-result">
      <p className="text-sm"><Badge tone={e.split === "test" ? "ok" : "warn"}>{SPLIT_LABEL[e.split]}</Badge> <span className="text-fg-muted">{e.nImages} images{e.split !== "test" ? " — not an independent estimate" : ""}</span></p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{EVAL_METRICS[task].filter((x) => m[x.key] != null).map((x) => <MetricTile key={x.key} label={`${x.label} (${e.split})`} value={pct(m[x.key])} help={x.help} />)}</div>
      <dl className="grid gap-1 text-xs text-fg-muted">{EVAL_METRICS[task].map((x) => <div key={x.key}><dt className="inline font-medium text-fg">{x.label}: </dt><dd className="inline">{x.help}</dd></div>)}</dl>
      {e.perClass && (
        <div className="overflow-x-auto rounded-lg border border-line"><table className="w-full text-left text-[13px]"><caption className="sr-only">Per-class results on the {e.split} split</caption>
          <thead className="bg-subtle text-xs text-fg-subtle"><tr><th className="p-2">Class</th>{task === "classify" && <th>Images</th>}<th>Precision</th><th>Recall</th>{task === "detect" ? <><th>AP@50</th><th>AP@50-95</th></> : <th>F1</th>}</tr></thead>
          <tbody>{e.perClass.map((c) => <tr key={c.class} className="border-t border-line"><td className="p-2 font-medium">{c.class}</td>{task === "classify" && <td>{c.support}</td>}<td>{pct(c.precision)}</td><td>{pct(c.recall)}</td>{task === "detect" ? <><td>{pct(c.ap50)}</td><td>{pct(c.ap5095)}</td></> : <td>{pct(c.f1)}</td>}</tr>)}</tbody></table></div>
      )}
      {cm && (
        <div><h3 className="mb-1 text-xs font-semibold">Confusion matrix <span className="font-normal text-fg-subtle">(rows: true class{task === "detect" ? "; columns: predicted, last = missed/background" : ", columns: predicted"})</span></h3>
          <div className="overflow-x-auto"><table className="text-center text-xs" data-testid="confusion"><thead><tr><th />{cm.labels.map((l) => <th key={l} className="px-1.5 pb-1 font-medium">{l}</th>)}</tr></thead>
            <tbody>{cm.matrix.map((row, i) => <tr key={i}><th className="pr-2 text-right font-medium">{cm.labels[i]}</th>{row.map((v, j) => <td key={j} className="h-9 w-12 border border-line tabular-nums" style={{ background: `color-mix(in srgb, var(--accent) ${Math.round((v / max) * 70)}%, transparent)` }}>{Math.round(v)}</td>)}</tr>)}</tbody></table></div></div>
      )}
      {e.speed && <p className="text-xs text-fg-muted">Speed on {e.speed.device}: {Object.entries(e.speed).filter(([k]) => k !== "device").map(([k, v]) => `${k.replace(/_/g, " ")} ${v} ms`).join(", ")}. Timing depends heavily on the worker's hardware.</p>}
      {errs.length > 0 && (
        <details className="rounded-lg border border-line p-3"><summary className="cursor-pointer text-[13px] font-medium">Error analysis — {task === "detect" ? `${m.errorAnalysis.imagesWithErrors} image(s) with false alarms or misses at confidence ${m.errorAnalysis.confidence}` : `${errs.length} misclassified image(s)`}</summary>
          <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">{errs.slice(0, 30).map((x) => <li key={x.imageId} className="font-mono text-fg-muted">{x.imageId.slice(0, 8)} {task === "detect" ? `· ${x.fp} false alarm(s), ${x.fn} missed` : `· true ${x.truth}, predicted ${x.predicted ?? "?"}`}</li>)}</ul></details>
      )}
    </div>
  );
}

function RegisterSection({ slug, run, canManage, reload }: { slug: string; run: Run; canManage: boolean; reload: () => void }) {
  const [open, setOpen] = useState(false); const [name, setName] = useState(""); const [notes, setNotes] = useState(""); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const tested = run.evaluations.some((e) => e.split === "test" && e.status === "completed");
  return (
    <section aria-labelledby="reg-h" className="space-y-2">
      <h2 id="reg-h" className="text-sm font-semibold">Model registry</h2>
      {run.models.length > 0 && <p className="text-[13px] text-fg-muted">Registered as {run.models.map((m, i) => <span key={m.id}>{i > 0 && ", "}<Link className="underline" href={`/w/${slug}/models`}>{m.name} v{m.number}</Link></span>)}.</p>}
      {canManage && <Button size="sm" onClick={() => setOpen(true)}><PackagePlus size={13} />Register as model</Button>}
      <Dialog open={open} onClose={() => setOpen(false)} title="Register as model">
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { await api(`/api/w/${slug}/models`, { body: { runId: run.id, name, notes } }); setOpen(false); reload(); } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); } }}>
          {err && <Alert>{err}</Alert>}
          {!tested && <Alert kind="warn">This run has no test-split evaluation yet. You can still register it, but its quality is only estimated from validation images.</Alert>}
          <Field label="Model name" hint="Reusing an existing name adds a new version to it; nothing is overwritten." htmlFor="rg-name"><Input id="rg-name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. waste-detector" /></Field>
          <Field label="Notes (optional)" htmlFor="rg-notes"><Textarea id="rg-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <div className="flex justify-end gap-2"><Button onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={busy || name.trim().length < 2}>Register</Button></div>
        </form>
      </Dialog>
    </section>
  );
}
