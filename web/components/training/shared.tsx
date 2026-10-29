"use client";
import Link from "next/link";
import useSWR from "swr";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/form";
import { fetcher } from "@/lib/client/api";

export type TaskType = "detect" | "classify";
export const STATUS_TONE: Record<string, "neutral" | "danger" | "warn" | "ok" | "accent"> = { queued: "neutral", running: "accent", completed: "ok", failed: "danger", cancelled: "neutral", interrupted: "warn" };
export const STATUS_LABEL: Record<string, string> = { queued: "Queued", running: "Running", completed: "Completed", failed: "Failed", cancelled: "Cancelled", interrupted: "Interrupted" };
export const isActive = (s: string) => s === "queued" || s === "running";
export function StatusBadge({ status }: { status: string }) { return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</Badge>; }

export const SPLIT_LABEL = { train: "Training split", val: "Validation split", test: "Test split" } as const;
/** Primary metrics per task; keys are what the worker stores (evaluation) and what Ultralytics logs (per-epoch). */
export const EVAL_METRICS: Record<TaskType, { key: string; label: string; help: string }[]> = {
  detect: [
    { key: "precision", label: "Precision", help: "Of the boxes the model drew, the share that were right. Low = many false alarms." },
    { key: "recall", label: "Recall", help: "Of the real items, the share the model found. Low = items are missed." },
    { key: "map50", label: "mAP@50", help: "Overall detection quality counting a box as right when it overlaps the true box by at least 50%." },
    { key: "map5095", label: "mAP@50-95", help: "Stricter version of mAP that also rewards tightly fitting boxes." },
  ],
  classify: [
    { key: "top1", label: "Top-1 accuracy", help: "Share of images where the model's first guess was correct." },
    { key: "top5", label: "Top-5 accuracy", help: "Share of images where the right class was among the five best guesses." },
  ],
};
export const EPOCH_KEY: Record<TaskType, string> = { detect: "metrics/mAP50(B)", classify: "metrics/accuracy_top1" };
export const EPOCH_LABEL: Record<TaskType, string> = { detect: "Validation mAP@50", classify: "Validation top-1 accuracy" };

export const pct = (v: unknown, d = 1) => (typeof v === "number" ? `${(v * 100).toFixed(d)}%` : "—");
export const num = (v: unknown, d = 3) => (typeof v === "number" ? v.toFixed(d) : "—");
export function dur(a: string | null, b: string | null) {
  if (!a) return "—";
  const s = Math.max(0, Math.round(((b ? new Date(b) : new Date()).getTime() - new Date(a).getTime()) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
export const when = (s: string | null) => (s ? new Date(s).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");

export type WorkerStatus = { workers: { id: string; name: string; online: boolean; lastSeen: string; info: Record<string, any> }[]; online: boolean; queued: number; running: number };
export function useWorkers(slug: string) { return useSWR<WorkerStatus>(`/api/w/${slug}/workers`, fetcher, { refreshInterval: 10000 }); }

/** Honest status: jobs do not run on the website; they wait for a worker machine. */
export function WorkerBanner({ slug }: { slug: string }) {
  const { data } = useWorkers(slug);
  if (!data || data.online) return null;
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-line bg-warn-soft p-3 text-[13px] text-warn" data-testid="no-worker">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <p>No worker is online. Training, evaluation, prediction and export jobs will wait in the queue until a worker starts. <Link className="underline" href={`/w/${slug}/jobs`}>How to start a worker</Link></p>
    </div>
  );
}

type Series = { name: string; color: string; points: { x: number; y: number }[] };
const W = 480, H = 200, PL = 44, PR = 10, PT = 10, PB = 26;
export function LineChart({ title, series, yFormat = (v: number) => v.toFixed(2), yMin }: { title: string; series: Series[]; yFormat?: (v: number) => string; yMin?: number }) {
  const pts = series.flatMap((s) => s.points);
  if (pts.length === 0) return <div className="flex h-[200px] items-center justify-center rounded-lg border border-dashed border-line text-xs text-fg-subtle">{title}: no epochs yet</div>;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs, x0 + 1);
  const lo = yMin ?? Math.min(...ys), hi = Math.max(...ys, lo + 1e-9);
  const sx = (x: number) => PL + ((x - x0) / (x1 - x0)) * (W - PL - PR), sy = (y: number) => PT + (1 - (y - lo) / (hi - lo)) * (H - PT - PB);
  const ticks = [0, 0.5, 1].map((t) => lo + (hi - lo) * t);
  return (
    <figure className="rounded-lg border border-line p-3">
      <figcaption className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs font-medium">{title}
        <span className="flex gap-3 font-normal text-fg-muted">{series.map((s) => <span key={s.name} className="inline-flex items-center gap-1"><i className="inline-block h-0.5 w-3" style={{ background: s.color }} />{s.name}</span>)}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${title}: ${series.map((s) => `${s.name} ${s.points.length} points`).join(", ")}`}>
        {ticks.map((t) => <g key={t}><line x1={PL} x2={W - PR} y1={sy(t)} y2={sy(t)} stroke="var(--border)" /><text x={PL - 6} y={sy(t) + 3} textAnchor="end" fontSize="10" fill="var(--fg-subtle)">{yFormat(t)}</text></g>)}
        {[x0, x1].map((x, i) => <text key={i} x={sx(x)} y={H - 8} textAnchor={i ? "end" : "start"} fontSize="10" fill="var(--fg-subtle)">epoch {x}</text>)}
        {series.map((s) => <g key={s.name}>
          <polyline fill="none" stroke={s.color} strokeWidth="2" points={s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")} />
          {s.points.map((p) => <circle key={p.x} cx={sx(p.x)} cy={sy(p.y)} r="2.5" fill={s.color}><title>{`${s.name}, epoch ${p.x}: ${yFormat(p.y)}`}</title></circle>)}
        </g>)}
      </svg>
    </figure>
  );
}

export function MetricTile({ label, value, help }: { label: string; value: string; help?: string }) {
  return <div className="rounded-lg border border-line p-3" title={help}><div className="text-xs text-fg-subtle">{label}</div><div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div></div>;
}
