"use client";
import Link from "next/link";
import useSWR from "swr";
import { Plus } from "lucide-react";
import { Alert, Button } from "@/components/ui/form";
import { fetcher } from "@/lib/client/api";
import { can, type Role } from "@/lib/authz";
import { EPOCH_KEY, EVAL_METRICS, StatusBadge, WorkerBanner, isActive, pct, when, type TaskType } from "./shared";

export type RunRow = {
  id: string; number: number; name: string; status: string; taskType: TaskType; arch: string; datasetName: string; versionNumber: number; epochsDone: number; config: { epochs: number };
  bestMetrics: Record<string, any> | null; progress: number | null; message: string | null; createdAt: string; createdBy: string | null; error: string | null;
};

export function TrainingPage({ slug, role }: { slug: string; role: Role }) {
  const { data, error } = useSWR<{ runs: RunRow[] }>(`/api/w/${slug}/runs`, fetcher, { refreshInterval: (d) => (d?.runs.some((r) => isActive(r.status)) ? 3000 : 15000) });
  const canRun = can(role, "training.run");
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-lg font-semibold">Training</h1><p className="text-sm text-fg-muted">Train a model on a frozen dataset version. Each run keeps its settings, logs and checkpoints.</p></div>
        {canRun && <Link href={`/w/${slug}/training/new`}><Button variant="primary"><Plus size={14} />New training run</Button></Link>}
      </div>
      <WorkerBanner slug={slug} />
      {error && <Alert>{(error as Error).message}</Alert>}
      {data && data.runs.length === 0 && (
        <div className="rounded-lg border border-dashed border-line p-8 text-center">
          <h2 className="text-base font-semibold">No training runs yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">Before training you need a dataset version: approved, labeled images split into train, validation and test.</p>
          {canRun ? <Link href={`/w/${slug}/training/new`}><Button className="mt-4" variant="primary">Start the first run</Button></Link> : <p className="mt-3 text-xs text-fg-subtle">Ask an ML Engineer or admin to start one.</p>}
        </div>
      )}
      {data && data.runs.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[13px]" data-testid="runs">
            <thead className="bg-subtle text-xs text-fg-subtle"><tr><th className="p-2.5">Run</th><th>Status</th><th>Data</th><th>Model</th><th>Epochs</th><th>Best validation result</th><th>Started</th></tr></thead>
            <tbody>
              {data.runs.map((r) => {
                const m = EVAL_METRICS[r.taskType][r.taskType === "detect" ? 2 : 0];
                const key = r.taskType === "detect" ? "metrics/mAP50(B)" : EPOCH_KEY.classify;
                return (
                  <tr key={r.id} className="border-t border-line hover:bg-hover">
                    <td className="p-2.5"><Link className="font-medium hover:underline" href={`/w/${slug}/training/${r.id}`}>#{r.number} {r.name}</Link></td>
                    <td><StatusBadge status={r.status} />{isActive(r.status) && r.progress != null && <span className="ml-1 text-xs text-fg-subtle">{Math.round(r.progress * 100)}%</span>}</td>
                    <td>{r.datasetName} · v{r.versionNumber}</td><td>{r.arch}</td><td className="tabular-nums">{r.epochsDone}/{r.config.epochs}</td>
                    <td>{r.bestMetrics ? <span>{m.label} {pct(r.bestMetrics[key])} <span className="text-xs text-fg-subtle">(val, epoch {r.bestMetrics.epoch})</span></span> : <span className="text-fg-subtle">—</span>}</td>
                    <td className="text-fg-muted">{when(r.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
