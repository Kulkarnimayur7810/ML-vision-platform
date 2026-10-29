"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { FolderSync, HardDrive, RefreshCw, Upload } from "lucide-react";
import { Alert, Badge, Button, Input, Select } from "@/components/ui/form";
import { api, fetcher } from "@/lib/client/api";
import { can, type Role } from "@/lib/authz";
import { cn } from "@/lib/cn";

type Stats = { total: number; unlabeled: number; labeled: number; approved: number; needsFixes: number; bytes: number };
type Cls = { index: number; name: string; guideline: string; boxes: number; images: number };
type Detail = { dataset: { id: string; name: string; description: string; taskType: "detect" | "classify" }; stats: Stats; classes: Cls[] };
type Img = { id: string; filename: string; status: string; classIndex: number | null; isBackground: boolean; boxCount: number; thumbUrl: string; driveFileId?: string | null };
type Version = { id: string; number: number; name: string; seed: number; ratios: { train: number; val: number; test: number }; counts: Record<string, number>; createdAt: string; createdBy: string | null };
type Quality = { issues: { code: string; severity: string; count: number; title: string; help: string; imageIds: string[] }[]; distribution: { name: string; count: number }[] };

const TABS = ["Images", "Classes", "Quality", "Versions", "Google Drive"] as const;
const STATUS: Record<string, [string, "neutral" | "accent" | "ok" | "warn"]> = { unlabeled: ["Unlabeled", "neutral"], labeled: ["Labeled", "accent"], approved: ["Approved", "ok"], needs_fixes: ["Needs fixes", "warn"] };

export function DatasetPage({ slug, id, role }: { slug: string; id: string; role: Role }) {
  const base = `/api/w/${slug}/datasets/${id}`;
  const { data, error, mutate } = useSWR<Detail>(base, fetcher);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Images");
  if (error) return <div className="p-4"><Alert>{(error as Error).message}</Alert></div>;
  if (!data) return <p className="p-4 text-sm text-fg-subtle">Loading…</p>;
  const { dataset: d, stats } = data;
  const detect = d.taskType === "detect";
  const pct = (n: number) => (stats.total ? Math.round((n / stats.total) * 100) : 0);
  const next = stats.total === 0 ? "Connect Google Drive or upload photos to get started." : stats.unlabeled + stats.needsFixes > 0 ? `${stats.unlabeled + stats.needsFixes} image(s) still need labels.` : stats.labeled > 0 ? `${stats.labeled} labeled image(s) are waiting for review.` : stats.approved >= 3 ? "Ready: create a version to freeze the labels and split them for training." : "";
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><Link href={`/w/${slug}/datasets`} className="text-[13px] text-fg-muted hover:text-fg">← Datasets</Link>
          <h1 className="mt-0.5 text-lg font-semibold">{d.name} <Badge tone="accent" className="ml-1 align-middle">{detect ? "Object detection" : "Classification"}</Badge></h1>
          {d.description && <p className="text-sm text-fg-muted">{d.description}</p>}</div>
        <div className="flex gap-2">
          {can(role, "annotate") && stats.total > 0 && <Link href={`/w/${slug}/datasets/${id}/annotate`} className="inline-flex h-9 items-center rounded-md bg-accent px-3.5 text-sm font-medium text-accent-fg hover:opacity-90">Label images</Link>}
          {can(role, "review") && stats.labeled > 0 && <Link href={`/w/${slug}/datasets/${id}/annotate?mode=review`} className="inline-flex h-9 items-center rounded-md border border-line-strong px-3.5 text-sm hover:bg-hover">Review ({stats.labeled})</Link>}
        </div>
      </div>
      <section aria-label="Progress" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {([["Images", stats.total], ["Unlabeled", stats.unlabeled], ["Labeled", stats.labeled], ["Needs fixes", stats.needsFixes], ["Approved", stats.approved]] as const).map(([l, n]) => (
          <div key={l} className="rounded-lg border border-line p-3"><div className="text-xl font-semibold">{n}</div><div className="text-xs text-fg-muted">{l}{stats.total && l !== "Images" ? ` · ${pct(n)}%` : ""}</div></div>
        ))}
      </section>
      {next && <p className="text-sm text-fg-muted"><span className="font-medium text-fg">Next step:</span> {next}</p>}
      <div role="tablist" className="flex gap-1 border-b border-line">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("-mb-px border-b-2 px-3 py-2 text-[13px] cursor-pointer", tab === t ? "border-accent font-medium" : "border-transparent text-fg-muted hover:text-fg")}>{t}</button>)}
      </div>
      {tab === "Images" && <ImagesTab slug={slug} id={id} role={role} detect={detect} classes={data.classes} onChanged={() => mutate()} />}
      {tab === "Classes" && <ClassesTab base={base} classes={data.classes} detect={detect} canEdit={can(role, "datasets.edit")} onChanged={() => mutate()} />}
      {tab === "Quality" && <QualityTab base={base} detect={detect} />}
      {tab === "Versions" && <VersionsTab base={base} stats={stats} canEdit={can(role, "datasets.edit")} />}
      {tab === "Google Drive" && <GoogleDriveTab slug={slug} datasetId={id} canEdit={can(role, "datasets.edit")} onSynced={() => mutate()} />}
    </div>
  );
}

function ImagesTab({ slug, id, role, detect, classes, onChanged }: { slug: string; id: string; role: Role; detect: boolean; classes: Cls[]; onChanged: () => void }) {
  const base = `/api/w/${slug}/datasets/${id}`;
  const [status, setStatus] = useState("");
  const { data, size, setSize, mutate, isValidating } = useSWRInfinite<{ items: Img[]; next: string | null }>(
    (i, prev) => (prev && !prev.next ? null : `${base}/images?limit=48${status ? `&status=${status}` : ""}${prev?.next ? `&after=${prev.next}` : ""}`), fetcher, { revalidateFirstPage: false });
  const items = data?.flatMap((p) => p.items) ?? [];
  const more = !!data?.[data.length - 1]?.next;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Filter by status" className="h-8 w-44 text-[13px]" value={status} onChange={(e) => { setStatus(e.target.value); }}>
          <option value="">All images</option><option value="unlabeled">Unlabeled</option><option value="labeled">Labeled</option><option value="needs_fixes">Needs fixes</option><option value="approved">Approved</option>
        </Select>
        {can(role, "datasets.edit") && <Uploader endpoint={`${base}/images`} onDone={() => { mutate(); onChanged(); }} />}
      </div>
      {!isValidating && items.length === 0 && <p className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-fg-subtle">{status ? "No images with this status." : "No images yet. You can connect Google Drive in the 'Google Drive' tab or upload local photos."}</p>}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6" data-testid="grid">
        {items.map((i) => (
          <li key={i.id}><Link href={`/w/${slug}/datasets/${id}/annotate/${i.id}`} className="group block overflow-hidden rounded-md border border-line hover:border-line-strong">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={i.thumbUrl} alt={i.filename} loading="lazy" className="aspect-square w-full bg-muted object-cover" />
            <div className="flex items-center justify-between gap-1 px-1.5 py-1"><Badge tone={STATUS[i.status][1]}>{STATUS[i.status][0]}</Badge><span className="truncate text-[11px] text-fg-subtle">{detect ? (i.isBackground ? "no objects" : i.boxCount ? `${i.boxCount} box${i.boxCount > 1 ? "es" : ""}` : "") : i.classIndex != null ? classes[i.classIndex]?.name : ""}</span></div>
          </Link></li>
        ))}
      </ul>
      {more && <Button onClick={() => setSize(size + 1)}>Load more</Button>}
    </div>
  );
}

function Uploader({ endpoint, onDone }: { endpoint: string; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "warn" | "error"; text: string; details?: string[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async (files: File[]) => {
    let added = 0, dup = 0; const bad: string[] = [];
    const batches: File[][] = []; let cur: File[] = []; let size = 0;
    for (const f of files) { if (cur.length >= 8 || size + f.size > 3.5 * 1024 * 1024) { if (cur.length) batches.push(cur); cur = []; size = 0; } cur.push(f); size += f.size; }
    if (cur.length) batches.push(cur);
    let done = 0;
    for (const b of batches) {
      setBusy(`Uploading ${done}/${files.length}…`);
      const fd = new FormData(); b.forEach((f) => fd.append("files", f));
      try {
        const res = await fetch(endpoint, { method: "POST", body: fd, credentials: "same-origin" });
        const j = await res.json();
        if (!res.ok) { bad.push(...b.map((f) => `${f.name}: ${j.error?.message ?? "failed"}`)); }
        else for (const r of j.results as { filename: string; status: string; message?: string }[]) { if (r.status === "added") added++; else if (r.status === "duplicate") dup++; else bad.push(`${r.filename}: ${r.message}`); }
      } catch (e) { bad.push(`${b.map((f) => f.name).join(", ")}: ${(e as Error).message}`); }
      done += b.length;
    }
    setBusy(null);
    setMsg({ kind: bad.length ? (added ? "warn" : "error") : "ok", text: `${added} added${dup ? `, ${dup} duplicate${dup > 1 ? "s" : ""} skipped` : ""}${bad.length ? `, ${bad.length} rejected` : ""}.`, details: bad.slice(0, 20) });
    onDone();
  }, [endpoint, onDone]);
  return (
    <div className="flex flex-1 flex-wrap items-center gap-2">
      <input ref={ref} type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Choose images to upload" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; if (f.length) void run(f); }} />
      <Button onClick={() => ref.current?.click()} disabled={!!busy}><Upload size={14} />{busy ?? "Upload local photos"}</Button>
      {msg && <div className="min-w-0 flex-1"><Alert kind={msg.kind === "ok" ? "ok" : msg.kind === "warn" ? "warn" : "error"}>{msg.text}{msg.details?.length ? <ul className="mt-1 list-disc pl-4 text-xs">{msg.details.map((d) => <li key={d}>{d}</li>)}</ul> : null}</Alert></div>}
    </div>
  );
}

function ClassesTab({ base, classes, detect, canEdit, onChanged }: { base: string; classes: Cls[]; detect: boolean; canEdit: boolean; onChanged: () => void }) {
  const [name, setName] = useState(""); const [err, setErr] = useState<string | null>(null);
  const call = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); onChanged(); } catch (e) { setErr((e as Error).message); } };
  return (
    <div className="max-w-2xl space-y-3">
      {err && <Alert>{err}</Alert>}
      <p className="text-sm text-fg-muted">Write a one-line rule for each class so everyone labels the same way. Classes can be renamed or added but not deleted, so saved labels never change meaning.</p>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {classes.map((c) => (
          <li key={c.index} className="flex flex-wrap items-center gap-2 p-2.5">
            <span className="w-6 text-xs text-fg-subtle">{c.index + 1}</span>
            <Input aria-label={`Name of class ${c.index + 1}`} className="w-40" defaultValue={c.name} disabled={!canEdit} onBlur={(e) => e.target.value !== c.name && call(() => api(`${base}/classes`, { method: "PATCH", body: { index: c.index, name: e.target.value } }))} />
            <Input aria-label={`Labeling rule for ${c.name}`} className="min-w-48 flex-1" placeholder="Labeling rule (optional)" defaultValue={c.guideline} disabled={!canEdit} onBlur={(e) => e.target.value !== c.guideline && call(() => api(`${base}/classes`, { method: "PATCH", body: { index: c.index, guideline: e.target.value } }))} />
            <Badge>{detect ? `${c.boxes} boxes` : `${c.images} images`}</Badge>
          </li>
        ))}
      </ul>
      {canEdit && <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) call(async () => { await api(`${base}/classes`, { body: { name } }); setName(""); }); }}>
        <Input aria-label="New class name" placeholder="New class name" value={name} onChange={(e) => setName(e.target.value)} /><Button type="submit" disabled={!name.trim()}>Add class</Button></form>}
    </div>
  );
}

function QualityTab({ base, detect }: { base: string; detect: boolean }) {
  const { data, error } = useSWR<Quality>(`${base}/quality`, fetcher);
  if (error) return <Alert>{(error as Error).message}</Alert>;
  if (!data) return <p className="text-sm text-fg-subtle">Checking your dataset…</p>;
  const max = Math.max(1, ...data.distribution.map((d) => d.count));
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section><h2 className="mb-2 text-sm font-semibold">Checks</h2>
        {data.issues.length === 0 ? <Alert kind="ok">No problems found in the images uploaded so far.</Alert> :
          <ul className="space-y-2" data-testid="issues">{data.issues.map((i) => <li key={i.code} className="rounded-lg border border-line p-3"><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{i.title}</span><Badge tone={i.severity === "warning" ? "warn" : i.severity === "error" ? "danger" : "neutral"}>{i.count}</Badge></div><p className="mt-0.5 text-xs text-fg-muted">{i.help}</p></li>)}</ul>}
        <p className="mt-2 text-xs text-fg-subtle">Near-duplicate detection compares small image fingerprints; it can miss duplicates that were cropped or re-lit heavily.</p></section>
      <section><h2 className="mb-2 text-sm font-semibold">Class balance ({detect ? "boxes" : "images"})</h2>
        <ul className="space-y-1.5" data-testid="distribution">{data.distribution.map((d) => <li key={d.name} className="flex items-center gap-2 text-[13px]"><span className="w-24 truncate">{d.name}</span><div className="h-3 flex-1 rounded bg-muted"><div className="h-full rounded bg-accent" style={{ width: `${(d.count / max) * 100}%` }} /></div><span className="w-10 text-right tabular-nums">{d.count}</span></li>)}</ul></section>
    </div>
  );
}

function VersionsTab({ base, stats, canEdit }: { base: string; stats: Stats; canEdit: boolean }) {
  const { data, mutate } = useSWR<{ versions: Version[] }>(`${base}/versions`, fetcher);
  const [name, setName] = useState(""); const [seed, setSeed] = useState(42); const [r, setR] = useState({ train: 70, val: 20, test: 10 });
  const [err, setErr] = useState<string | null>(null); const [ok, setOk] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportingDrive, setExportingDrive] = useState<string | null>(null);
  const m = /\/api\/w\/([^/]+)\/datasets\/([^/]+)/.exec(base); const wsSlug = m?.[1], dsId = m?.[2];
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <section><h2 className="mb-2 text-sm font-semibold">Versions</h2>
        <p className="mb-2 text-sm text-fg-muted">A version freezes the <em>approved</em> images and their labels, then splits them into train / validation / test. Training always uses a version, so results stay reproducible even if labels change later.</p>
        {err && <Alert>{err}</Alert>}{ok && <Alert kind="ok">{ok}</Alert>}
        {data?.versions.length === 0 && <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-fg-subtle">No versions yet.</p>}
        <ul className="space-y-2" data-testid="versions">{data?.versions.map((v) => <li key={v.id} className="rounded-lg border border-line p-3"><div className="flex items-center justify-between"><span className="font-medium">{v.name}</span><span className="text-xs text-fg-subtle">{new Date(v.createdAt).toLocaleDateString()} · {v.createdBy}</span></div>
          <p className="mt-1 text-[13px] text-fg-muted">{v.counts.total} images — train {v.counts.train} · validation {v.counts.val} · test {v.counts.test} <span className="text-fg-subtle">(seed {v.seed})</span></p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link href={`/w/${wsSlug}/training/new?dataset=${dsId}&version=${v.id}`}><Button size="sm">Train on this version</Button></Link>
            {canEdit && <Button size="sm" disabled={exporting === v.id} onClick={async () => { setExporting(v.id); setErr(null); setOk(null); try { await api(`${base}/versions/${v.id}/export`, { method: "POST", body: {} }); setOk("Export queued. A worker will build the zip; download it from Jobs & workers."); } catch (e2) { setErr((e2 as Error).message); } finally { setExporting(null); } }}>Export zip</Button>}
            {canEdit && <Button size="sm" disabled={exportingDrive === v.id} onClick={async () => { setExportingDrive(v.id); setErr(null); setOk(null); try { const res = await api<{ message: string }>(`${base}/versions/${v.id}/export-drive`, { method: "POST", body: {} }); setOk(res.message); } catch (e2) { setErr((e2 as Error).message); } finally { setExportingDrive(null); } }}>Export YOLO to Drive</Button>}
          </div></li>)}</ul></section>
      {canEdit && <section className="h-fit rounded-lg border border-line p-4"><h2 className="mb-2 text-sm font-semibold">Create version</h2>
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(null); setOk(null); try { const x = await api<{ number: number; counts: Record<string, number>; keptTest: number; unusedClasses: string[] }>(`${base}/versions`, { body: { name: name || undefined, seed, ratios: { train: r.train / 100, val: r.val / 100, test: r.test / 100 } } }); setOk(`Created v${x.number}: ${x.counts.train}/${x.counts.val}/${x.counts.test}.${x.keptTest ? ` ${x.keptTest} earlier test image(s) stayed in test.` : ""}${x.unusedClasses.length ? ` No examples yet for: ${x.unusedClasses.join(", ")}.` : ""}`); mutate(); } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); } }}>
          <p className="text-xs text-fg-muted">{stats.approved} approved image{stats.approved === 1 ? "" : "s"} available.</p>
          <label className="block text-[13px] font-medium">Name (optional)<Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="v1" /></label>
          <div className="grid grid-cols-3 gap-2 text-[13px] font-medium">{(["train", "val", "test"] as const).map((k) => <label key={k}>{k === "val" ? "Validation" : k[0].toUpperCase() + k.slice(1)} %<Input className="mt-1" type="number" min={0} max={100} value={r[k]} onChange={(e) => setR({ ...r, [k]: Number(e.target.value) })} /></label>)}</div>
          <label className="block text-[13px] font-medium">Random seed<Input className="mt-1" type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} /></label>
          <p className="text-xs text-fg-subtle">Near-identical photos always land in the same split. Images that were in an earlier version's test split stay there.</p>
          <Button type="submit" variant="primary" disabled={busy || stats.approved < 3}>Create version</Button></form></section>}
    </div>
  );
}

/* ──────────────────── Google Drive Integration Tab ──────────────────── */

type DriveConn = {
  connected: boolean;
  connection?: {
    email: string | null;
    folderId: string | null;
    folderName: string | null;
    labelsFolderId: string | null;
    exportsFolderId: string | null;
    connectedAt: string;
  };
};

function GoogleDriveTab({
  slug,
  datasetId,
  canEdit,
  onSynced,
}: {
  slug: string;
  datasetId: string;
  canEdit: boolean;
  onSynced: () => void;
}) {
  const driveBase = `/api/w/${slug}/drive`;
  const { data: connData, mutate: mutateConn } = useSWR<DriveConn>(`${driveBase}/status`, fetcher);
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [selectedFolder, setSelectedFolder] = useState("");
  const [customFolderId, setCustomFolderId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  const conn = connData?.connection;

  // Load folders once connected
  useEffect(() => {
    if (connData?.connected) {
      api<{ folders: { id: string; name: string }[] }>(`${driveBase}/folders`)
        .then((res) => {
          setFolders(res.folders);
          if (conn?.folderId) setSelectedFolder(conn.folderId);
        })
        .catch(() => {});
    }
  }, [connData?.connected, conn?.folderId, driveBase]);

  const handleConnect = async () => {
    setErr(null);
    try {
      const res = await api<{ url: string }>(`${driveBase}/auth`);
      window.location.href = res.url;
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleSaveConfig = async () => {
    const fId = selectedFolder || customFolderId.trim();
    if (!fId) {
      setErr("Please select or enter a Google Drive folder ID.");
      return;
    }
    setSavingConfig(true);
    setErr(null);
    setOk(null);
    try {
      const folderName = folders.find((f) => f.id === fId)?.name ?? "Source Folder";
      await api(`${driveBase}/configure`, {
        method: "POST",
        body: { folderId: fId, folderName },
      });
      setOk("Google Drive folder and subfolders configured successfully.");
      mutateConn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSyncImages = async () => {
    setSyncing(true);
    setErr(null);
    setOk(null);
    setSyncStatus("Starting sync from Google Drive…");
    let totalImported = 0;
    let totalSkipped = 0;
    let pageToken: string | undefined = undefined;

    try {
      do {
        const res: { imported: number; skipped: number; nextPageToken: string | null; hasMore: boolean } =
          await api(`${driveBase}/sync`, {
            method: "POST",
            body: { datasetId, pageToken, pageSize: 50 },
          });

        totalImported += res.imported;
        totalSkipped += res.skipped;
        pageToken = res.nextPageToken || undefined;
        setSyncStatus(`Sync in progress: ${totalImported} imported, ${totalSkipped} already present…`);
      } while (pageToken);

      setOk(`Sync complete! ${totalImported} new images added (${totalSkipped} duplicate/existing skipped).`);
      setSyncStatus(null);
      onSynced();
    } catch (e) {
      setErr((e as Error).message);
      setSyncStatus(null);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      {err && <Alert>{err}</Alert>}
      {ok && <Alert kind="ok">{ok}</Alert>}

      <div className="rounded-lg border border-line p-4 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <HardDrive size={18} className="text-accent" />
              Google Drive Dataset Connection
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              Store 10,000–100,000 original photos and YOLO label files directly in Google Drive. Supabase coordinates metadata and annotations while images are streamed securely.
            </p>
          </div>
          {connData?.connected && (
            <Badge tone="ok">Connected: {conn?.email || "Google Account"}</Badge>
          )}
        </div>

        {!connData?.connected ? (
          <div className="border border-dashed border-line rounded-lg p-6 text-center space-y-3">
            <p className="text-sm text-fg-muted">
              Connect the Google Account that has access to your shared dataset folder.
            </p>
            {canEdit ? (
              <Button variant="primary" onClick={handleConnect}>
                Connect Google Account
              </Button>
            ) : (
              <p className="text-xs text-fg-subtle">
                Only workspace administrators can connect Google Drive.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            {/* Folder selection */}
            <div className="space-y-2">
              <label className="block text-sm font-medium">Source folder (Original Images)</label>
              <div className="flex flex-wrap gap-2">
                <Select
                  className="flex-1 min-w-[200px]"
                  value={selectedFolder}
                  onChange={(e) => setSelectedFolder(e.target.value)}
                  disabled={!canEdit || savingConfig}
                >
                  <option value="">Select a folder from Drive…</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
                {canEdit && (
                  <Button onClick={handleSaveConfig} disabled={savingConfig || !selectedFolder}>
                    Save Folder
                  </Button>
                )}
              </div>
              <p className="text-xs text-fg-subtle">
                Or enter shared folder ID manually if it does not appear in the list:
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="Paste Google Drive folder ID"
                  value={customFolderId}
                  onChange={(e) => setCustomFolderId(e.target.value)}
                  disabled={!canEdit || savingConfig}
                />
                {canEdit && (
                  <Button
                    onClick={() => {
                      setSelectedFolder(customFolderId.trim());
                      handleSaveConfig();
                    }}
                    disabled={savingConfig || !customFolderId.trim()}
                  >
                    Set ID
                  </Button>
                )}
              </div>
            </div>

            {/* Folder layout summary */}
            {conn?.folderId && (
              <div className="rounded bg-muted p-3 text-xs space-y-1">
                <div className="font-medium text-fg">Active Drive Configuration:</div>
                <div>Source Folder ID: <code className="text-fg-subtle">{conn.folderId}</code> ({conn.folderName})</div>
                <div>Labels Folder ID: <code className="text-fg-subtle">{conn.labelsFolderId || "auto-managed"}</code></div>
                <div>Exports Folder ID: <code className="text-fg-subtle">{conn.exportsFolderId || "auto-managed"}</code></div>
              </div>
            )}

            {/* Sync actions */}
            {conn?.folderId && canEdit && (
              <div className="border-t border-line pt-4 space-y-2">
                <h3 className="text-sm font-medium">Sync Images</h3>
                <p className="text-xs text-fg-muted">
                  Reads image files from your Drive folder and records metadata in Supabase. Existing images are skipped idempotently.
                </p>
                <div className="flex items-center gap-3">
                  <Button variant="primary" onClick={handleSyncImages} disabled={syncing}>
                    {syncing ? <RefreshCw size={14} className="animate-spin" /> : <FolderSync size={14} />}
                    {syncing ? "Syncing Drive…" : "Sync Images from Drive"}
                  </Button>
                  {syncStatus && <span className="text-xs text-fg-subtle">{syncStatus}</span>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Google Colab Instructions */}
      <div className="rounded-lg border border-line p-4 space-y-2">
        <h3 className="text-sm font-semibold">Google Colab Training Workflow</h3>
        <p className="text-xs text-fg-muted leading-relaxed">
          1. Annotators label images in WasteVision AI. Bounding boxes are saved to Supabase and exported as YOLO <code>.txt</code> files to Drive.<br />
          2. Freeze and approve labels in the <strong>Versions</strong> tab, then click <strong>Export YOLO to Drive</strong>.<br />
          3. Open Google Colab, mount Google Drive (<code>from google.colab import drive; drive.mount(&apos;/content/drive&apos;)</code>), and train YOLOv8 on your dataset with ₹0 compute cost.
        </p>
      </div>
    </div>
  );
}
