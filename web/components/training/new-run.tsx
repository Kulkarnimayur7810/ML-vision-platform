"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Alert, Badge, Button, Field, Input, Select } from "@/components/ui/form";
import { api, fetcher } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { WorkerBanner } from "./shared";

type DS = { id: string; name: string; taskType: "detect" | "classify"; approved: number; versions: number };
type Version = { id: string; number: number; name: string; counts: Record<string, number>; createdAt: string };
const ARCHS = {
  detect: [["yolov8n", "YOLOv8 Nano", "Smallest and fastest. The best first choice, especially without a GPU."], ["yolov8s", "YOLOv8 Small", "Better on small objects, roughly 3× slower to train."], ["yolo11n", "YOLO11 Nano", "Newer nano model."], ["yolo11s", "YOLO11 Small", "Newer small model."]],
  classify: [["yolov8n-cls", "YOLOv8 Nano classifier", "Smallest and fastest."], ["yolov8s-cls", "YOLOv8 Small classifier", "A bit more accurate, slower."], ["yolo11n-cls", "YOLO11 Nano classifier", "Newer nano model."], ["yolo11s-cls", "YOLO11 Small classifier", "Newer small model."]],
} as const;
const PRESETS = [
  { id: "quick", label: "Quick test", epochs: 5, imgsz: 320, batch: 8, text: "A few minutes on CPU. Only to check that everything works — expect weak results." },
  { id: "balanced", label: "Balanced", epochs: 50, imgsz: 640, batch: 16, text: "A sensible starting point for a small dataset. Plan for a GPU, or hours on CPU." },
  { id: "thorough", label: "Thorough", epochs: 100, imgsz: 640, batch: 16, text: "Longer training. Stops early if validation stops improving." },
] as const;
const STEPS = ["Data", "Model", "Settings", "Review"] as const;

export function NewRun({ slug }: { slug: string }) {
  const router = useRouter();
  const qs = useSearchParams();
  const { data: dsData } = useSWR<{ datasets: DS[] }>(`/api/w/${slug}/datasets`, fetcher);
  const [step, setStep] = useState(0);
  const [datasetId, setDatasetId] = useState(qs.get("dataset") ?? "");
  const [versionId, setVersionId] = useState(qs.get("version") ?? "");
  const { data: vData } = useSWR<{ versions: Version[] }>(datasetId ? `/api/w/${slug}/datasets/${datasetId}/versions` : null, fetcher);
  const ds = dsData?.datasets.find((d) => d.id === datasetId);
  const versions = useMemo(() => vData?.versions ?? [], [vData]);
  const version = versions.find((v) => v.id === versionId);
  useEffect(() => { if (vData && !vData.versions.find((v) => v.id === versionId)) setVersionId(vData.versions[0]?.id ?? ""); }, [vData, versionId]);
  const [arch, setArch] = useState(""); const [pretrained, setPretrained] = useState(true);
  const [preset, setPreset] = useState<(typeof PRESETS)[number]["id"]>("balanced");
  const [adv, setAdv] = useState({ epochs: 50, imgsz: 640, batch: 16, lr0: 0.01, patience: 50, seed: 0, device: "auto" as "auto" | "cpu" | "cuda:0" });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const task = ds?.taskType ?? "detect";
  const archList = ARCHS[task];
  useEffect(() => { if (ds && !archList.some((a) => a[0] === arch)) setArch(archList[0][0]); }, [ds, arch, archList]);
  function pick(p: (typeof PRESETS)[number]) { setPreset(p.id); setAdv((a) => ({ ...a, epochs: p.epochs, imgsz: p.imgsz, batch: p.batch })); }
  const noTrain = !!version && ((version.counts.train ?? 0) < 1 || (version.counts.val ?? 0) < 1);
  const canNext = [!!version && !noTrain, !!arch, adv.epochs >= 1 && adv.imgsz % 32 === 0 && adv.batch >= 1, true][step];

  async function start() {
    if (busy) return; // guards double clicks
    setBusy(true); setErr(null);
    try {
      const r = await api<{ id: string }>(`/api/w/${slug}/runs`, { body: { versionId, arch, pretrained, name: name.trim() || undefined, ...adv } });
      router.push(`/w/${slug}/training/${r.id}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div><h1 className="text-lg font-semibold">New training run</h1><p className="text-sm text-fg-muted">Four short steps. Nothing starts until you press Start on the last one.</p></div>
      <ol className="flex gap-1 text-xs" aria-label="Steps">{STEPS.map((s, i) => <li key={s} aria-current={i === step ? "step" : undefined} className={cn("flex-1 rounded px-2 py-1.5 text-center", i === step ? "bg-accent text-accent-fg font-medium" : i < step ? "bg-accent-soft text-fg" : "bg-muted text-fg-subtle")}>{i + 1}. {s}</li>)}</ol>
      <WorkerBanner slug={slug} />
      {err && <Alert>{err}</Alert>}

      {step === 0 && (
        <section className="space-y-4">
          {dsData && dsData.datasets.length === 0 && <Alert kind="warn">There are no datasets yet. <Link className="underline" href={`/w/${slug}/datasets`}>Create one</Link>, label some images and create a version first.</Alert>}
          <Field label="Dataset" htmlFor="nr-ds">
            <Select id="nr-ds" value={datasetId} onChange={(e) => { setDatasetId(e.target.value); setVersionId(""); }}>
              <option value="">Choose a dataset…</option>
              {dsData?.datasets.map((d) => <option key={d.id} value={d.id}>{d.name} — {d.taskType === "detect" ? "object detection" : "classification"}, {d.versions} version{d.versions === 1 ? "" : "s"}</option>)}
            </Select>
          </Field>
          {ds && vData && versions.length === 0 && <Alert kind="warn">This dataset has no versions. A version freezes the approved labels and splits the images. <Link className="underline" href={`/w/${slug}/datasets/${ds.id}`}>Open the dataset</Link> and use <em>Versions → Create version</em>{ds.approved < 3 ? ` (you need at least 3 approved images; there are ${ds.approved})` : ""}.</Alert>}
          {versions.length > 0 && (
            <Field label="Dataset version" htmlFor="nr-ver" hint="Training always uses a frozen version so the run can be reproduced later.">
              <Select id="nr-ver" value={versionId} onChange={(e) => setVersionId(e.target.value)}>{versions.map((v) => <option key={v.id} value={v.id}>v{v.number} — {v.name} ({v.counts.train ?? 0} train / {v.counts.val ?? 0} val / {v.counts.test ?? 0} test)</option>)}</Select>
            </Field>
          )}
          {noTrain && <Alert kind="warn">This version has no images in the {(version!.counts.train ?? 0) < 1 ? "train" : "validation"} split, so training cannot run. Create a new version with more approved images.</Alert>}
          {version && !noTrain && (version.counts.test ?? 0) < 1 && <Alert kind="info">This version has no test images. You can train, but you will not be able to run an honest final evaluation.</Alert>}
          {ds && (
            <div className="rounded-lg border border-line bg-subtle p-3 text-[13px] text-fg-muted">
              {task === "detect" ? <><b className="text-fg">Object detection</b> — the model draws a box around every item and names it. Use this when several items can appear in one photo or you need to know where each one is.</> : <><b className="text-fg">Classification</b> — the model gives one label for the whole image. It cannot locate items or count several in one photo.</>}
            </div>
          )}
        </section>
      )}

      {step === 1 && (
        <section className="space-y-4">
          <fieldset><legend className="mb-1 text-[13px] font-medium">Model</legend>
            <div className="grid gap-2 sm:grid-cols-2">{archList.map(([id, label, note], i) => (
              <label key={id} className={cn("cursor-pointer rounded-lg border p-3", arch === id ? "border-accent bg-accent-soft" : "border-line hover:bg-hover")}>
                <input type="radio" name="arch" className="sr-only" checked={arch === id} onChange={() => setArch(id)} />
                <span className="flex items-center justify-between text-sm font-medium">{label}{i === 0 && <Badge tone="accent">Recommended</Badge>}</span><span className="mt-0.5 block text-xs text-fg-muted">{note}</span>
              </label>))}</div>
          </fieldset>
          <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-[13px]">
            <input type="checkbox" className="mt-0.5" checked={pretrained} onChange={(e) => setPretrained(e.target.checked)} />
            <span><b>Start from pretrained weights</b> (recommended)<span className="block text-fg-muted">The model begins already knowing general shapes and textures from a large public dataset, so it learns your classes much faster from far fewer photos. Turn off only to train from scratch. The weights are downloaded by the worker the first time.</span></span>
          </label>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4">
          <fieldset><legend className="mb-1 text-[13px] font-medium">How long should it train?</legend>
            <div className="grid gap-2 sm:grid-cols-3">{PRESETS.map((p) => (
              <label key={p.id} className={cn("cursor-pointer rounded-lg border p-3", preset === p.id ? "border-accent bg-accent-soft" : "border-line hover:bg-hover")}>
                <input type="radio" name="preset" className="sr-only" checked={preset === p.id} onChange={() => pick(p)} />
                <span className="text-sm font-medium">{p.label}</span><span className="block text-xs text-fg-subtle">{p.epochs} epochs · {p.imgsz}px</span><span className="mt-1 block text-xs text-fg-muted">{p.text}</span>
              </label>))}</div>
          </fieldset>
          <details className="rounded-lg border border-line p-3">
            <summary className="cursor-pointer text-[13px] font-medium">Advanced settings</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Epochs" hint="Passes over the training images." htmlFor="a-ep"><Input id="a-ep" type="number" min={1} max={300} value={adv.epochs} onChange={(e) => setAdv({ ...adv, epochs: +e.target.value })} /></Field>
              <Field label="Image size (px)" hint="Multiple of 32. Larger finds small objects better but is slower." htmlFor="a-sz"><Input id="a-sz" type="number" step={32} min={32} max={1280} value={adv.imgsz} onChange={(e) => setAdv({ ...adv, imgsz: +e.target.value })} /></Field>
              <Field label="Batch size" hint="Lower it if the worker runs out of memory." htmlFor="a-b"><Input id="a-b" type="number" min={1} max={128} value={adv.batch} onChange={(e) => setAdv({ ...adv, batch: +e.target.value })} /></Field>
              <Field label="Learning rate" htmlFor="a-lr"><Input id="a-lr" type="number" step="0.001" min={0.00001} max={0.1} value={adv.lr0} onChange={(e) => setAdv({ ...adv, lr0: +e.target.value })} /></Field>
              <Field label="Early-stop patience" hint="Stop if validation hasn't improved for this many epochs." htmlFor="a-p"><Input id="a-p" type="number" min={1} max={300} value={adv.patience} onChange={(e) => setAdv({ ...adv, patience: +e.target.value })} /></Field>
              <Field label="Device" hint="'Automatic' uses a GPU when the worker has one." htmlFor="a-d"><Select id="a-d" value={adv.device} onChange={(e) => setAdv({ ...adv, device: e.target.value as typeof adv.device })}><option value="auto">Automatic</option><option value="cpu">CPU</option><option value="cuda:0">GPU 0</option></Select></Field>
              <Field label="Random seed" htmlFor="a-s"><Input id="a-s" type="number" min={0} value={adv.seed} onChange={(e) => setAdv({ ...adv, seed: +e.target.value })} /></Field>
            </div>
          </details>
        </section>
      )}

      {step === 3 && ds && version && (
        <section className="space-y-3">
          <Field label="Run name (optional)" htmlFor="nr-name"><Input id="nr-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={`${ds.name} v${version.number} · ${arch}`} /></Field>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-line p-3 text-[13px] sm:grid-cols-3">
            {[["Dataset", `${ds.name} (${task === "detect" ? "detection" : "classification"})`], ["Version", `v${version.number}: ${version.counts.train ?? 0}/${version.counts.val ?? 0}/${version.counts.test ?? 0} train/val/test`], ["Model", `${arch}${pretrained ? " (pretrained)" : " (from scratch)"}`], ["Epochs", String(adv.epochs)], ["Image size", `${adv.imgsz}px`], ["Batch", String(adv.batch)], ["Learning rate", String(adv.lr0)], ["Device", adv.device === "auto" ? "Automatic" : adv.device]].map(([k, v]) => <div key={k}><dt className="text-xs text-fg-subtle">{k}</dt><dd className="font-medium">{v}</dd></div>)}
          </dl>
          <p className="text-xs text-fg-muted">The run is queued and a worker machine picks it up. Progress, logs and a loss curve appear on the next page. During training the numbers shown come from the <b>validation</b> split; the <b>test</b> split is only used when you run a final evaluation.</p>
        </section>
      )}

      <div className="flex justify-between border-t border-line pt-3">
        <Button onClick={() => (step === 0 ? router.push(`/w/${slug}/training`) : setStep(step - 1))}>{step === 0 ? "Cancel" : "Back"}</Button>
        {step < 3 ? <Button variant="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Next</Button> : <Button variant="primary" disabled={busy} onClick={start}>{busy ? "Starting…" : "Start training"}</Button>}
      </div>
    </div>
  );
}
