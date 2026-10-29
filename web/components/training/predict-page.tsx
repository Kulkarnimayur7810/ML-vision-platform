"use client";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Alert, Badge, Button, Field, Select } from "@/components/ui/form";
import { api, fetcher } from "@/lib/client/api";
import { can, type Role } from "@/lib/authz";
import { StatusBadge, WorkerBanner, isActive, pct } from "./shared";
import type { RunRow } from "./training-page";

type Det = { class: string; classIndex: number; confidence: number; box: number[] };
type Frame = { frame: number; time?: number; width: number; height: number; latencyMs: number; detections?: Det[]; top?: { class: string; confidence: number }[] };
type Pred = { id: string; kind: "image" | "video"; filename: string; conf: number; iou: number; status: string; error: string | null; imageUrl: string | null; result: { task: string; device: string; frames: Frame[] } | null };
const PALETTE = ["#e11d48", "#2563eb", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#be185d", "#65a30d"];

export function PredictPage({ slug, role }: { slug: string; role: Role }) {
  const { data } = useSWR<{ runs: RunRow[] }>(`/api/w/${slug}/runs`, fetcher);
  const runs = (data?.runs ?? []).filter((r) => r.status === "completed");
  const [runId, setRunId] = useState(""); const [conf, setConf] = useState(0.25); const [iou, setIou] = useState(0.7);
  const [file, setFile] = useState<File | null>(null); const [predId, setPredId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!runId && runs[0]) setRunId(runs[0].id); }, [runs, runId]);
  const { data: pred } = useSWR<Pred>(predId ? `/api/w/${slug}/predictions/${predId}` : null, fetcher, { refreshInterval: (d) => (!d || isActive(d.status) ? 2000 : 0) });
  const canRun = can(role, "training.run");
  const run = runs.find((r) => r.id === runId);

  async function go() {
    if (!file || !runId || busy) return;
    setBusy(true); setErr(null); setPredId(null);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("conf", String(conf)); fd.append("iou", String(iou));
      const res = await fetch(`/api/w/${slug}/runs/${runId}/predict`, { method: "POST", body: fd });
      const j = await res.json(); if (!res.ok) throw new Error(j.error?.message ?? "Upload failed");
      setPredId(j.id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div><h1 className="text-lg font-semibold">Test &amp; Predict</h1><p className="text-sm text-fg-muted">Try a trained model on a photo or short clip. This is a quick sanity check, not a measurement — use Evaluation on the test split for real numbers.</p></div>
      <WorkerBanner slug={slug} />
      {data && runs.length === 0 && <Alert kind="info">No finished training runs yet. Train a model first.</Alert>}
      {!canRun && <Alert kind="info">Your role can view results but not run predictions.</Alert>}
      {runs.length > 0 && canRun && (
        <div className="grid gap-4 rounded-lg border border-line p-4 md:grid-cols-2">
          <div className="space-y-3">
            <Field label="Model (training run)" htmlFor="p-run"><Select id="p-run" value={runId} onChange={(e) => setRunId(e.target.value)}>{runs.map((r) => <option key={r.id} value={r.id}>#{r.number} {r.name} ({r.arch})</option>)}</Select></Field>
            <Field label="Image or short video" htmlFor="p-file" hint="JPEG, PNG or WebP, or an MP4/WebM clip up to 60 s. At most 4 MB here — a hosting limit."><input id="p-file" ref={input} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" className="block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
            {run?.taskType === "detect" && <>
              <Field label={`Confidence threshold: ${conf.toFixed(2)}`} hint="Hide detections the model is less sure about than this." htmlFor="p-conf"><input id="p-conf" type="range" min={0.05} max={0.95} step={0.05} value={conf} onChange={(e) => setConf(+e.target.value)} className="w-full" /></Field>
              <Field label={`Overlap (IoU) threshold: ${iou.toFixed(2)}`} hint="Merges duplicate boxes on the same item. Lower merges more." htmlFor="p-iou"><input id="p-iou" type="range" min={0.3} max={0.95} step={0.05} value={iou} onChange={(e) => setIou(+e.target.value)} className="w-full" /></Field>
            </>}
            {err && <Alert>{err}</Alert>}
            <Button variant="primary" disabled={!file || busy} onClick={go}>{busy ? "Uploading…" : "Run prediction"}</Button>
          </div>
          <div aria-live="polite">
            {!pred && <p className="flex h-full min-h-40 items-center justify-center rounded-lg border border-dashed border-line text-sm text-fg-subtle">Results appear here.</p>}
            {pred && !pred.result && <div className="space-y-2"><StatusBadge status={pred.status} />{isActive(pred.status) && <p className="text-sm text-fg-muted">Waiting for a worker to run the model…</p>}{pred.error && <Alert>{pred.error}</Alert>}</div>}
            {pred?.result && <Result pred={pred} />}
          </div>
        </div>
      )}
    </div>
  );
}

function Result({ pred }: { pred: Pred }) {
  const [i, setI] = useState(0);
  const frames = pred.result!.frames;
  const f = frames[Math.min(i, frames.length - 1)];
  if (!f) return <Alert kind="info">The model returned no frames.</Alert>;
  const dets = f.detections;
  return (
    <div className="space-y-2" data-testid="prediction">
      {pred.kind === "image" && pred.imageUrl && (
        <div className="relative overflow-hidden rounded-lg border border-line bg-black/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pred.imageUrl} alt={`Uploaded ${pred.filename}`} className="block w-full" />
          {dets && <svg viewBox={`0 0 ${f.width} ${f.height}`} className="absolute inset-0 h-full w-full" aria-hidden>
            {dets.map((d, k) => { const [x1, y1, x2, y2] = d.box; const c = PALETTE[d.classIndex % PALETTE.length]; const fs = Math.max(10, f.height / 36); return <g key={k}><rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} fill="none" stroke={c} strokeWidth={Math.max(2, f.height / 220)} /><rect x={x1} y={Math.max(0, y1 - fs * 1.4)} width={fs * 0.62 * (d.class.length + 5)} height={fs * 1.4} fill={c} /><text x={x1 + 3} y={Math.max(fs, y1 - fs * 0.35)} fontSize={fs} fill="#fff">{d.class} {Math.round(d.confidence * 100)}%</text></g>; })}
          </svg>}
        </div>
      )}
      {pred.kind === "video" && frames.length > 1 && <label className="block text-xs">Frame {f.frame}{f.time != null ? ` (${f.time}s)` : ""}<input type="range" min={0} max={frames.length - 1} value={i} onChange={(e) => setI(+e.target.value)} className="block w-full" /></label>}
      {dets && (dets.length === 0 ? <p className="text-sm text-fg-muted">Nothing detected above confidence {pred.conf.toFixed(2)}. Try lowering the threshold — or the model may not have learned this item.</p> :
        <table className="w-full text-left text-[13px]"><caption className="sr-only">Detections</caption><thead className="text-xs text-fg-subtle"><tr><th>Class</th><th>Confidence</th><th>Box (px)</th></tr></thead><tbody>{dets.map((d, k) => <tr key={k} className="border-t border-line"><td className="py-1 font-medium">{d.class}</td><td>{pct(d.confidence, 0)}</td><td className="font-mono text-xs">{d.box.map(Math.round).join(", ")}</td></tr>)}</tbody></table>)}
      {f.top && <ul className="space-y-1">{f.top.map((t) => <li key={t.class} className="text-[13px]"><div className="flex justify-between"><span>{t.class}</span><span className="tabular-nums">{pct(t.confidence)}</span></div><div className="h-1.5 rounded bg-muted"><div className="h-full rounded bg-accent" style={{ width: `${t.confidence * 100}%` }} /></div></li>)}</ul>}
      <p className="text-xs text-fg-muted">Model time {f.latencyMs} ms on {pred.result!.device} (includes first-call warm-up). <Badge tone="neutral">{pred.kind === "video" ? `${frames.length} sampled frames` : "1 image"}</Badge></p>
    </div>
  );
}
