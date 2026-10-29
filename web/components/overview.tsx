"use client";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/client/api";
import { Badge } from "@/components/ui/form";
import type { MlSummary } from "@/lib/server/overview";

type Counts = { open: number; in_progress: number; blocked: number; done: number; overdue: number; mine: number; unassigned: number };

const pct = (v: number | null) => (v == null ? "not evaluated" : `${(v * 100).toFixed(1)}%`);
export function Overview({ slug, name, counts, upcoming, ml }: { slug: string; name: string; counts: Counts; ml: MlSummary; upcoming: { number: number; title: string; due: string }[] }) {
  const { data: act } = useSWR<{ items: { id: number; summary: string; actor: string; at: string }[] }>(`/api/w/${slug}/activity?limit=12`, fetcher, { refreshInterval: 20000 });
  const base = `/w/${slug}/kanban`;
  const tiles: [string, number, string, string?][] = [
    ["Open tasks", counts.open, base], ["In progress", counts.in_progress, base], ["Blocked", counts.blocked, `${base}?blocked=1`],
    ["Overdue", counts.overdue, `${base}?overdue=1`, counts.overdue ? "danger" : undefined], ["Assigned to me", counts.mine, `${base}?assignee=me`], ["Unassigned", counts.unassigned, `${base}?unassigned=1`, counts.unassigned ? "warn" : undefined],
    ["Completed", counts.done, `${base}?completed=1`],
  ];
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div><h1 className="text-lg font-semibold">Welcome, {name.split(" ")[0]}</h1><p className="text-sm text-fg-muted">What's happening in your team's workspace.</p></div>
      <section aria-label="AI project" className="space-y-2" data-testid="ml-summary">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">AI project</h2>
          <Link href={ml.next.href} className="rounded-md bg-accent-soft px-2.5 py-1 text-[13px] text-fg hover:underline"><b>Next:</b> {ml.next.text}</Link></div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([["Datasets", `${ml.datasets}`, `${ml.versions} version${ml.versions === 1 ? "" : "s"}`, `/w/${slug}/datasets`],
            ["Images approved", `${ml.approved}/${ml.images}`, `${ml.labeled} labeled`, `/w/${slug}/datasets`],
            ["Training runs", `${ml.runs.total}`, `${ml.runs.completed} completed${ml.runs.running + ml.runs.queued ? `, ${ml.runs.running + ml.runs.queued} active` : ""}${ml.runs.failed ? `, ${ml.runs.failed} failed` : ""}`, `/w/${slug}/training`],
            ["Registered models", `${ml.models.total}`, ml.models.selected ? `selected: ${ml.models.selected.name} v${ml.models.selected.number}` : "none selected", `/w/${slug}/models`]] as const).map(([l, v, sub, href]) => (
            <Link key={l} href={href} className="rounded-lg border border-line p-3 hover:bg-hover"><div className="text-2xl font-semibold">{v}</div><div className="text-xs text-fg-muted">{l}</div><div className="mt-0.5 truncate text-xs text-fg-subtle">{sub}</div></Link>))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-line p-3 text-[13px]"><h3 className="mb-1 text-xs font-medium text-fg-subtle">Latest completed run</h3>
            {ml.latest ? <><Link className="font-medium hover:underline" href={`/w/${slug}/training/${ml.latest.id}`}>#{ml.latest.number} {ml.latest.name}</Link>
              <dl className="mt-1 grid grid-cols-2 gap-2"><div><dt className="text-xs text-fg-subtle">{ml.latest.metric} · validation</dt><dd className="font-medium">{pct(ml.latest.valScore)}</dd></div><div><dt className="text-xs text-fg-subtle">{ml.latest.metric} · test</dt><dd className="font-medium">{pct(ml.latest.testScore)}</dd></div></dl></> : <p className="text-fg-subtle">No completed runs yet.</p>}</div>
          <div className="rounded-lg border border-line p-3 text-[13px]"><h3 className="mb-1 text-xs font-medium text-fg-subtle">Worker</h3>
            <p><span className={ml.worker.online ? "font-medium text-ok" : "font-medium text-warn"}>{ml.worker.online ? "Online" : "No worker online"}</span>{ml.worker.queued ? ` · ${ml.worker.queued} job(s) queued` : ""}</p>
            <Link className="text-xs text-accent underline" href={`/w/${slug}/jobs`}>Jobs & workers</Link></div>
        </div>
      </section>
      <section aria-label="Task summary" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map(([label, n, href, tone]) => (
          <Link key={label} href={href} className="rounded-lg border border-line p-3 hover:bg-hover">
            <div className={tone === "danger" ? "text-2xl font-semibold text-danger" : tone === "warn" ? "text-2xl font-semibold text-warn" : "text-2xl font-semibold"}>{n}</div>
            <div className="text-xs text-fg-muted">{label}</div>
          </Link>
        ))}
      </section>
      <div className="grid gap-6 md:grid-cols-2">
        <section aria-labelledby="up"><h2 id="up" className="mb-2 text-sm font-semibold">Upcoming deadlines</h2>
          {upcoming.length === 0 ? <p className="rounded-lg border border-dashed border-line p-4 text-sm text-fg-subtle">No upcoming deadlines. <Link className="text-accent underline" href={base}>Open the board</Link> to add tasks with due dates.</p> :
            <ul className="divide-y divide-line rounded-lg border border-line">{upcoming.map((t) => <li key={t.number}><Link href={`${base}/tasks/${t.number}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-hover"><span className="truncate"><span className="text-fg-subtle">#{t.number}</span> {t.title}</span><Badge>{t.due}</Badge></Link></li>)}</ul>}
        </section>
        <section aria-labelledby="act"><h2 id="act" className="mb-2 text-sm font-semibold">Recent activity</h2>
          {!act ? <p className="text-sm text-fg-subtle">Loading…</p> : act.items.length === 0 ? <p className="rounded-lg border border-dashed border-line p-4 text-sm text-fg-subtle">No activity yet.</p> :
            <ul className="divide-y divide-line rounded-lg border border-line">{act.items.map((a) => <li key={a.id} className="px-3 py-2 text-sm"><span className="font-medium">{a.actor}</span> <span className="text-fg-muted">{a.summary}</span><div className="text-xs text-fg-subtle">{new Date(a.at).toLocaleString()}</div></li>)}</ul>}
        </section>
      </div>
      <p className="text-xs text-fg-subtle">Everything on this page is counted from your workspace. A result that hasn't been measured shows as “not evaluated”, never an estimate.</p>
    </div>
  );
}
