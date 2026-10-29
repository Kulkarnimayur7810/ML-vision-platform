"use client";
import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Alert, Badge, Button } from "@/components/ui/form";
import { api, fetcher } from "@/lib/client/api";
import { EPOCH_KEY, EPOCH_LABEL, LineChart, pct, when, type TaskType } from "@/components/training/shared";
import type { RunRow } from "@/components/training/training-page";

type CRun = { id: string; number: number; name: string; arch: string; pretrained: boolean; datasetName: string; versionNumber: number; config: Record<string, any>; epochsDone: number; seconds: number | null;
  val: Record<string, any> | null; test: Record<string, any> | null; valEval: Record<string, any> | null; curve: Record<string, any>[] };
type Cmp = { taskType: TaskType; sameDataVersion: boolean; runs: CRun[] };
const COLORS = ["#2f6f4e", "#c2410c", "#2563eb", "#9333ea", "#0891b2", "#be185d"];
const METRICS: Record<TaskType, { label: string; val: string; ev: string }[]> = {
  detect: [{ label: "Precision", val: "metrics/precision(B)", ev: "precision" }, { label: "Recall", val: "metrics/recall(B)", ev: "recall" }, { label: "mAP@50", val: "metrics/mAP50(B)", ev: "map50" }, { label: "mAP@50-95", val: "metrics/mAP50-95(B)", ev: "map5095" }],
  classify: [{ label: "Top-1 accuracy", val: "metrics/accuracy_top1", ev: "top1" }, { label: "Top-5 accuracy", val: "metrics/accuracy_top5", ev: "top5" }],
};

export function ExperimentsPage({ slug }: { slug: string }) {
  const { data } = useSWR<{ runs: RunRow[] }>(`/api/w/${slug}/runs`, fetcher);
  const [sel, setSel] = useState<string[]>([]);
  const [cmp, setCmp] = useState<Cmp | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const runs = (data?.runs ?? []).filter((r) => r.status === "completed");
  const tasks = new Set(runs.filter((r) => sel.includes(r.id)).map((r) => r.taskType));
  async function compare() { setBusy(true); setErr(null); try { setCmp(await api<Cmp>(`/api/w/${slug}/experiments/compare?ids=${sel.join(",")}`)); } catch (e) { setErr((e as Error).message); setCmp(null); } finally { setBusy(false); } }
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div><h1 className="text-lg font-semibold">Experiments</h1><p className="text-sm text-fg-muted">Pick two to six finished runs of the same kind and compare them with identical metric definitions.</p></div>
      {data && runs.length < 2 && <Alert kind="info">You need at least two completed training runs to compare. <Link className="underline" href={`/w/${slug}/training`}>Go to Training</Link>.</Alert>}
      {runs.length > 0 && (
        <fieldset className="rounded-lg border border-line">
          <legend className="sr-only">Runs to compare</legend>
          <ul className="divide-y divide-line">{runs.map((r) => (
            <li key={r.id}><label className="flex cursor-pointer items-center gap-3 p-2.5 text-[13px] hover:bg-hover">
              <input type="checkbox" checked={sel.includes(r.id)} disabled={!sel.includes(r.id) && sel.length >= 6} onChange={(e) => setSel(e.target.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))} />
              <span className="min-w-0 flex-1"><b>#{r.number} {r.name}</b> <span className="text-fg-subtle">· {r.datasetName} v{r.versionNumber} · {r.arch} · {when(r.createdAt)}</span></span>
              <Badge tone="neutral">{r.taskType === "detect" ? "detection" : "classification"}</Badge>
            </label></li>))}</ul>
        </fieldset>
      )}
      <div className="flex items-center gap-3"><Button variant="primary" disabled={sel.length < 2 || tasks.size > 1 || busy} onClick={compare}>Compare {sel.length || ""} runs</Button>
        {tasks.size > 1 && <span className="text-xs text-warn">Detection and classification runs can't be compared.</span>}</div>
      {err && <Alert>{err}</Alert>}
      {cmp && <Compare slug={slug} cmp={cmp} />}
    </div>
  );
}

function best(vals: (number | null | undefined)[], i: number) { const nums = vals.filter((v): v is number => typeof v === "number"); return nums.length > 1 && vals[i] === Math.max(...nums); }

function Compare({ slug, cmp }: { slug: string; cmp: Cmp }) {
  const rows: [string, (r: CRun) => string][] = [["Model", (r) => r.arch], ["Starting weights", (r) => (r.pretrained ? "pretrained" : "from scratch")], ["Data", (r) => `${r.datasetName} v${r.versionNumber}`], ["Epochs trained", (r) => `${r.epochsDone}/${r.config.epochs}`], ["Image size", (r) => `${r.config.imgsz}px`], ["Batch", (r) => String(r.config.batch)], ["Learning rate", (r) => String(r.config.lr0)], ["Train time", (r) => (r.seconds != null ? `${r.seconds}s` : "—")]];
  const th = "p-2 text-left text-xs font-medium text-fg-subtle";
  return (
    <div className="space-y-4" data-testid="compare">
      {!cmp.sameDataVersion && <Alert kind="warn">These runs used different dataset versions, so differences may come from the data rather than the model or settings. Compare like with like when you can.</Alert>}
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-[13px]">
          <thead className="bg-subtle"><tr><th className={th}>&nbsp;</th>{cmp.runs.map((r, i) => <th key={r.id} className="p-2 text-left"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: COLORS[i] }} /><Link className="hover:underline" href={`/w/${slug}/training/${r.id}`}>#{r.number} {r.name}</Link></th>)}</tr></thead>
          <tbody>
            {rows.map(([label, f]) => <tr key={label} className="border-t border-line"><th scope="row" className={th}>{label}</th>{cmp.runs.map((r) => <td key={r.id} className="p-2">{f(r)}</td>)}</tr>)}
            <tr className="border-t border-line bg-subtle"><th colSpan={cmp.runs.length + 1} className="p-2 text-left text-xs font-semibold">Best <u>validation</u> epoch <span className="font-normal text-fg-subtle">(guided training — optimistic)</span></th></tr>
            {METRICS[cmp.taskType].map((m) => { const v = cmp.runs.map((r) => r.val?.[m.val] as number | undefined); return <tr key={m.val} className="border-t border-line"><th scope="row" className={th}>{m.label} (val)</th>{cmp.runs.map((r, i) => <td key={r.id} className={best(v, i) ? "p-2 font-semibold text-ok" : "p-2"}>{pct(v[i])}{best(v, i) && <span className="sr-only"> (best)</span>}</td>)}</tr>; })}
            <tr className="border-t border-line bg-subtle"><th colSpan={cmp.runs.length + 1} className="p-2 text-left text-xs font-semibold">Final <u>test</u> evaluation <span className="font-normal text-fg-subtle">(images never used in training)</span></th></tr>
            {METRICS[cmp.taskType].map((m) => { const v = cmp.runs.map((r) => r.test?.[m.ev] as number | undefined); return <tr key={m.ev} className="border-t border-line"><th scope="row" className={th}>{m.label} (test)</th>{cmp.runs.map((r, i) => <td key={r.id} className={best(v, i) ? "p-2 font-semibold text-ok" : "p-2"}>{r.test ? pct(v[i]) : <Link className="text-xs text-fg-subtle underline" href={`/w/${slug}/training/${r.id}`}>not evaluated</Link>}</td>)}</tr>; })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-fg-muted">Highlighted = best of the compared runs. Test results exist only where you ran “Evaluate on test”; a missing value is never filled in. If runs used different test images, test scores are not directly comparable.</p>
      <LineChart title={`${EPOCH_LABEL[cmp.taskType]} by epoch`} yMin={0} yFormat={(v) => pct(v, 0)} series={cmp.runs.map((r, i) => ({ name: `#${r.number}`, color: COLORS[i], points: r.curve.filter((c) => typeof c[EPOCH_KEY[cmp.taskType]] === "number").map((c) => ({ x: c.epoch, y: c[EPOCH_KEY[cmp.taskType]] as number })) }))} />
    </div>
  );
}
