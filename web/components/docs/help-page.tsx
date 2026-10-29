"use client";
import Link from "next/link";
import useSWR from "swr";
import { Check, Circle } from "lucide-react";
import { fetcher } from "@/lib/client/api";

type DS = { id: string; images: number; labeled: number; approved: number; versions: number };
type Run = { status: string; taskType: string };
type Model = { id: string };

const TERMS: [string, string][] = [
  ["Classification vs detection", "Classification answers “what is in this photo?” with one label. Detection finds every item, draws a box around it and names it. A conveyor with several items in view needs detection."],
  ["Train / validation / test", "Train images teach the model. Validation images are checked after every epoch to guide training. Test images are held back and used once at the end — the only honest estimate of how it will do on new photos."],
  ["Epoch", "One full pass over the training images. More epochs help until the model starts memorising instead of learning."],
  ["Overfitting", "The model scores well on images it has seen but poorly on new ones. Sign: training loss keeps falling while validation results stall or drop."],
  ["Precision", "Of everything the model reported, how much was right. Low precision means false alarms."],
  ["Recall", "Of everything really there, how much the model found. Low recall means missed items."],
  ["mAP@50 / mAP@50-95", "A single detection score that combines precision and recall across confidence levels. @50 counts a box as correct if it overlaps the true box by 50%; @50-95 averages stricter overlaps, so it is lower and rewards tight boxes."],
  ["Confusion matrix", "A table of what the model predicted (columns) against what was true (rows). Off-diagonal cells show which classes get mixed up."],
  ["Confidence and IoU thresholds", "Confidence hides guesses the model is unsure about. IoU decides when two overlapping boxes are treated as the same item and merged."],
  ["Pretrained weights", "Starting from a model that already learned general shapes from a huge public dataset. It usually reaches good results with far fewer of your own photos."],
];

export function HelpPage({ slug }: { slug: string }) {
  const { data: ds } = useSWR<{ datasets: DS[] }>(`/api/w/${slug}/datasets`, fetcher);
  const { data: runs } = useSWR<{ runs: Run[] }>(`/api/w/${slug}/runs`, fetcher);
  const { data: models } = useSWR<{ models: Model[] }>(`/api/w/${slug}/models`, fetcher);
  const { data: w } = useSWR<{ online: boolean }>(`/api/w/${slug}/workers`, fetcher);
  const d = ds?.datasets ?? [];
  const steps = [
    { done: d.length > 0, title: "Create a dataset", body: "Choose detection or classification and list your classes.", href: `/w/${slug}/datasets` },
    { done: d.some((x) => x.images >= 1), title: "Upload photos", body: "Vary lighting, angle and background. Cover every class, including the awkward ones.", href: `/w/${slug}/datasets` },
    { done: d.some((x) => x.labeled >= 1), title: "Label them", body: "Draw boxes (or pick a class) in the Annotation workspace. Write guidelines in Documentation so everyone labels the same way.", href: `/w/${slug}/annotate` },
    { done: d.some((x) => x.approved >= 3), title: "Review and approve", body: "A second person approves labels. Only approved images go into training.", href: `/w/${slug}/annotate` },
    { done: d.some((x) => x.versions >= 1), title: "Create a dataset version", body: "Freezes the approved labels and splits them into train / validation / test.", href: `/w/${slug}/datasets` },
    { done: !!w?.online, title: "Start a worker", body: "Training runs on a computer you control, not on the website.", href: `/w/${slug}/jobs` },
    { done: (runs?.runs ?? []).some((r) => r.status === "completed"), title: "Train a model", body: "Start with the Nano model, pretrained, and a Quick test to confirm the pipeline works.", href: `/w/${slug}/training` },
    { done: false, title: "Evaluate on the test split", body: "Run the final test evaluation once you are happy with the settings, and record it in an experiment report.", href: `/w/${slug}/training` },
    { done: (models?.models ?? []).length > 0, title: "Register the model you will use", body: "Registered versions are never overwritten, and show validation and test results side by side.", href: `/w/${slug}/models` },
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4 md:p-6">
      <div><h1 className="text-lg font-semibold">Guide</h1><p className="text-sm text-fg-muted">The path from photos to a model you can trust. Ticks come from what exists in this workspace.</p></div>
      <section aria-labelledby="path-h"><h2 id="path-h" className="mb-2 text-sm font-semibold">Workflow</h2>
        <ol className="space-y-2">{steps.map((s, i) => (
          <li key={s.title}><Link href={s.href} className="flex gap-3 rounded-lg border border-line p-3 hover:bg-hover">
            <span className="mt-0.5 text-accent" aria-label={s.done ? "Done" : "Not done yet"}>{s.done ? <Check size={16} /> : <Circle size={16} className="text-fg-subtle" />}</span>
            <span><span className="block text-[13.5px] font-medium">{i + 1}. {s.title}</span><span className="block text-[13px] text-fg-muted">{s.body}</span></span></Link></li>))}</ol>
        <p className="mt-2 text-xs text-fg-subtle">The last evaluation step has no automatic tick: it is a decision, not a record.</p>
      </section>
      <section aria-labelledby="gl-h"><h2 id="gl-h" className="mb-2 text-sm font-semibold">Plain-language glossary</h2>
        <dl className="divide-y divide-line rounded-lg border border-line">{TERMS.map(([t, x]) => <div key={t} className="p-3"><dt className="text-[13px] font-medium">{t}</dt><dd className="mt-0.5 text-[13px] text-fg-muted">{x}</dd></div>)}</dl>
      </section>
      <section aria-labelledby="tips-h" className="space-y-2"><h2 id="tips-h" className="text-sm font-semibold">Getting trustworthy results</h2>
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-fg-muted">
          <li>Small objects need larger image sizes and enough photos where they appear small. Collect those on purpose.</li>
          <li>Put near-identical photos (the same item shot twice) in the same split — versions do this automatically.</li>
          <li>Don't tune settings against the test split. If you do, it is no longer a fair test; collect new test photos.</li>
          <li>With few images, expect noisy scores. A single percentage point difference between runs is usually not meaningful.</li>
          <li>Check the confusion matrix and error analysis before trusting one headline number.</li>
        </ul></section>
      <section aria-labelledby="limits-h" className="space-y-2"><h2 id="limits-h" className="text-sm font-semibold">What this app does not do</h2>
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-fg-muted">
          <li>It does not run training on the website: a worker machine does. Without one, jobs wait in the queue.</li>
          <li>It does not control hardware or deploy models to a sorter. Download the registered .pt file and run it with Ultralytics.</li>
          <li>Browser uploads are limited to about 4 MB per request by the hosting platform.</li>
        </ul></section>
    </div>
  );
}
