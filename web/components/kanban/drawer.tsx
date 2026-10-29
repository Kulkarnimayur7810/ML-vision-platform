"use client";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Archive, Link2, Plus, X } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Avatar, Badge, Button, Field, Input, Select, Textarea } from "@/components/ui/form";
import { api, ApiError, fetcher } from "@/lib/client/api";
import { PRIORITIES, type Board, type Priority, type Task } from "@/lib/kanban-types";
import { PRIORITY_LABEL } from "./card";
import { cn } from "@/lib/cn";

type Detail = { task: Task; comments: { id: number; body: string; createdAt: string; author: { id: string; name: string } | null }[]; activity: { id: number; summary: string; at: string; actor: string }[] };

export function TaskDrawer({ slug, number, board, canEditAny, me, onClose, refresh }: {
  slug: string; number: number | null; board: Board; canEditAny: boolean; me: string; onClose: () => void; refresh: () => void;
}) {
  const key = number ? `/api/w/${slug}/tasks/by-number/${number}` : null;
  const { data, error, mutate } = useSWR<Detail>(key, fetcher, { revalidateOnFocus: false });
  return (
    <Dialog open={!!number} onClose={onClose} title={number ? `Task #${number}` : "Task"} side>
      {error && <Alert>{(error as Error).message}</Alert>}
      {!data && !error && <p className="text-sm text-fg-subtle">Loading…</p>}
      {data && <DrawerBody key={data.task.id + ":" + data.task.version} slug={slug} detail={data} board={board} canEditAny={canEditAny} me={me} onClose={onClose}
        reload={async () => { await mutate(); refresh(); }} />}
    </Dialog>
  );
}

function DrawerBody({ slug, detail, board, canEditAny, me, onClose, reload }: { slug: string; detail: Detail; board: Board; canEditAny: boolean; me: string; onClose: () => void; reload: () => Promise<void> }) {
  const t = detail.task;
  const mine = t.createdBy?.id === me || t.assignees.some((a) => a.id === me);
  const editable = canEditAny || mine;
  const [f, setF] = useState({ title: t.title, description: t.description, priority: t.priority as Priority, dueDate: t.dueDate ?? "", startDate: t.startDate ?? "", workstream: t.workstream ?? "", assignees: t.assignees.map((a) => a.id), labels: t.labels.map((l) => l.id) });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState("");
  const [comment, setComment] = useState("");
  const [sub, setSub] = useState("");
  const dirty = useMemo(() => JSON.stringify(f) !== JSON.stringify({ title: t.title, description: t.description, priority: t.priority, dueDate: t.dueDate ?? "", startDate: t.startDate ?? "", workstream: t.workstream ?? "", assignees: t.assignees.map((a) => a.id), labels: t.labels.map((l) => l.id) }), [f, t]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  const base = `/api/w/${slug}/tasks/${t.id}`;
  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true); setErr(null);
    try { await fn(); after?.(); await reload(); }
    catch (e) { setErr(e instanceof ApiError && e.code === "conflict" ? e.message : (e as Error).message); }
    finally { setBusy(false); }
  }
  const toggle = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  const col = board.columns.find((c) => c.id === t.columnId);
  const open = t.blockedBy.filter((b) => !b.done);
  const subtasks = board.tasks.filter((x) => x.parentId === t.id);
  const candidates = board.tasks.filter((x) => x.id !== t.id && !t.blockedBy.some((b) => b.id === x.id));
  const people_ = board.members.filter((m) => m.name.toLowerCase().includes(people.toLowerCase()));

  return (
    <div className="space-y-5">
      {err && <Alert>{err}</Alert>}
      {open.length > 0 && <Alert kind="warn">Blocked by {open.map((b) => `#${b.number} ${b.title}`).join("; ")}. This task can't be marked done until they are.</Alert>}
      {!editable && <Alert kind="info">You can read this task. Only its creator, assignees and project engineers/admins can edit it.</Alert>}
      <fieldset disabled={!editable || busy} className="space-y-4">
        <Field label="Title" htmlFor="t-title"><Input id="t-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status" htmlFor="t-status">
            <Select id="t-status" value={t.columnId} onChange={(e) => run(() => api(`${base}/move`, { body: { version: t.version, columnId: e.target.value } }))}>
              {board.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="t-pri"><Select id="t-pri" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</Select></Field>
          <Field label="Start date" htmlFor="t-start"><Input id="t-start" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="Due date" htmlFor="t-due"><Input id="t-due" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        </div>
        <Field label="Workstream" htmlFor="t-ws" hint="e.g. Dataset, Annotation, Training, Hardware"><Input id="t-ws" value={f.workstream} onChange={(e) => setF({ ...f, workstream: e.target.value })} maxLength={60} /></Field>
        <Field label="Description" htmlFor="t-desc"><Textarea id="t-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={5} /></Field>
        <Field label={`Assignees (${f.assignees.length})`}>
          <div className="rounded-md border border-line">
            <Input aria-label="Search team members" placeholder="Search members…" value={people} onChange={(e) => setPeople(e.target.value)} className="rounded-b-none border-0 border-b border-line" />
            <ul className="max-h-40 overflow-y-auto p-1">
              {people_.map((m) => (
                <li key={m.id}><label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-hover">
                  <input type="checkbox" checked={f.assignees.includes(m.id)} onChange={() => setF({ ...f, assignees: toggle(f.assignees, m.id) })} />
                  <Avatar name={m.name} size={20} /> {m.name}</label></li>
              ))}
              {!people_.length && <li className="px-2 py-2 text-sm text-fg-subtle">No members match.</li>}
            </ul>
          </div>
        </Field>
        <Field label="Labels">
          <div className="flex flex-wrap gap-1.5">
            {board.labels.map((l) => (
              <button type="button" key={l.id} aria-pressed={f.labels.includes(l.id)} onClick={() => setF({ ...f, labels: toggle(f.labels, l.id) })}
                className={cn("rounded-full border px-2.5 py-0.5 text-xs cursor-pointer", f.labels.includes(l.id) ? "border-accent bg-accent-soft text-accent" : "border-line text-fg-muted hover:bg-hover")}>{l.name}</button>
            ))}
            <NewLabel slug={slug} onCreated={async (id) => { await reload(); setF((x) => ({ ...x, labels: [...x.labels, id] })); }} />
          </div>
        </Field>
        <div className="flex items-center gap-2">
          <Button variant="primary" disabled={!dirty || !f.title.trim()} onClick={() => run(() => api(base, { method: "PATCH", body: {
            version: t.version, title: f.title, description: f.description, priority: f.priority, dueDate: f.dueDate || null, startDate: f.startDate || null,
            workstream: f.workstream || null, assigneeIds: f.assignees, labelIds: f.labels } }))}>Save changes</Button>
          {dirty && <><Button variant="ghost" onClick={() => setF({ title: t.title, description: t.description, priority: t.priority, dueDate: t.dueDate ?? "", startDate: t.startDate ?? "", workstream: t.workstream ?? "", assignees: t.assignees.map((a) => a.id), labels: t.labels.map((l) => l.id) })}>Discard</Button><span className="text-xs text-warn">Unsaved changes</span></>}
        </div>
      </fieldset>

      <section className="border-t border-line pt-4">
        <h3 className="mb-2 text-sm font-semibold">Subtasks {t.subtaskTotal > 0 && <span className="font-normal text-fg-subtle">{t.subtaskDone}/{t.subtaskTotal} done</span>}</h3>
        {t.subtaskTotal > 0 && <div className="mb-2 h-1.5 overflow-hidden rounded bg-muted" role="progressbar" aria-valuenow={t.subtaskDone} aria-valuemax={t.subtaskTotal} aria-label="Subtask progress"><div className="h-full bg-accent" style={{ width: `${(t.subtaskDone / t.subtaskTotal) * 100}%` }} /></div>}
        <ul className="space-y-1">{subtasks.map((s) => <li key={s.id} className="flex items-center justify-between text-sm"><a className="hover:underline" href={`?task=${s.number}`}>#{s.number} {s.title}</a><Badge tone={s.done ? "ok" : "neutral"}>{board.columns.find((c) => c.id === s.columnId)?.name}</Badge></li>)}</ul>
        {!t.parentId && (
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!sub.trim()) return; run(() => api(`/api/w/${slug}/tasks`, { body: { title: sub, parentId: t.id, columnId: board.columns.find((c) => c.kind === "backlog")?.id ?? t.columnId } }), () => setSub("")); }}>
            <Input aria-label="New subtask title" placeholder="Add a subtask" value={sub} onChange={(e) => setSub(e.target.value)} />
            <Button type="submit" size="sm" disabled={!sub.trim() || busy}><Plus size={14} />Add</Button>
          </form>
        )}
      </section>

      <section className="border-t border-line pt-4">
        <h3 className="mb-2 text-sm font-semibold">Blocked by</h3>
        <ul className="space-y-1">{t.blockedBy.map((b) => <li key={b.id} className="flex items-center justify-between text-sm"><span><Link2 size={12} className="mr-1 inline" aria-hidden />#{b.number} {b.title} {b.done && <Badge tone="ok">Done</Badge>}</span>
          {editable && <button aria-label={`Remove dependency on #${b.number}`} className="rounded p-1 hover:bg-hover cursor-pointer" onClick={() => run(() => api(`${base}/dependencies`, { method: "DELETE", body: { blockerId: b.id } }))}><X size={14} /></button>}</li>)}
          {!t.blockedBy.length && <li className="text-sm text-fg-subtle">Nothing is blocking this task.</li>}</ul>
        {editable && candidates.length > 0 && (
          <Select aria-label="Add a blocking task" className="mt-2" value="" onChange={(e) => e.target.value && run(() => api(`${base}/dependencies`, { body: { blockerId: e.target.value } }))}>
            <option value="">Add a blocking task…</option>{candidates.map((c) => <option key={c.id} value={c.id}>#{c.number} {c.title}</option>)}
          </Select>
        )}
      </section>

      <section className="border-t border-line pt-4">
        <h3 className="mb-2 text-sm font-semibold">Comments</h3>
        <ul className="space-y-3">
          {detail.comments.map((c) => <li key={c.id} className="text-sm"><div className="flex items-center gap-2"><Avatar name={c.author?.name ?? "?"} size={20} /><span className="font-medium">{c.author?.name ?? "Deleted user"}</span><span className="text-xs text-fg-subtle">{new Date(c.createdAt).toLocaleString()}</span></div><p className="mt-1 whitespace-pre-wrap pl-7">{c.body}</p></li>)}
          {!detail.comments.length && <li className="text-sm text-fg-subtle">No comments yet.</li>}
        </ul>
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); run(() => api(`${base}/comments`, { body: { body: comment } }), () => setComment("")); }}>
          <Textarea aria-label="Write a comment" placeholder="Write a comment…" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
          <Button type="submit" size="sm" disabled={!comment.trim() || busy}>Comment</Button>
        </form>
      </section>

      <section className="border-t border-line pt-4">
        <h3 className="mb-2 text-sm font-semibold">Activity</h3>
        <ul className="space-y-1.5">{detail.activity.map((a) => <li key={a.id} className="text-xs text-fg-muted"><span className="font-medium text-fg">{a.actor}</span> {a.summary} · {new Date(a.at).toLocaleString()}</li>)}</ul>
        <p className="mt-2 text-xs text-fg-subtle">Created {t.createdBy ? `by ${t.createdBy.name} ` : ""}on {new Date(t.createdAt).toLocaleDateString()} · column: {col?.name}</p>
      </section>

      {editable && (
        <div className="border-t border-line pt-4">
          <ArchiveButton onConfirm={() => run(() => api(`${base}/archive`, { body: { archive: !t.archivedAt } }), onClose)} archived={!!t.archivedAt} />
        </div>
      )}
    </div>
  );
}

function ArchiveButton({ onConfirm, archived }: { onConfirm: () => void; archived: boolean }) {
  const [ask, setAsk] = useState(false);
  if (!ask) return <Button variant="ghost" size="sm" onClick={() => setAsk(true)}><Archive size={14} />{archived ? "Restore task" : "Archive task"}</Button>;
  return <div className="flex items-center gap-2 text-sm"><span>{archived ? "Restore this task?" : "Archive this task? It leaves the board but can be restored."}</span><Button size="sm" variant="danger" onClick={onConfirm}>{archived ? "Restore" : "Archive"}</Button><Button size="sm" variant="ghost" onClick={() => setAsk(false)}>Cancel</Button></div>;
}

function NewLabel({ slug, onCreated }: { slug: string; onCreated: (id: string) => void }) {
  const [on, setOn] = useState(false); const [name, setName] = useState("");
  if (!on) return <button type="button" onClick={() => setOn(true)} className="rounded-full border border-dashed border-line px-2.5 py-0.5 text-xs text-fg-subtle hover:bg-hover cursor-pointer">+ New label</button>;
  return <span className="flex gap-1"><Input aria-label="New label name" className="h-6 w-28 text-xs" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} onKeyDown={async (e) => { if (e.key === "Enter") { e.preventDefault(); if (!name.trim()) return; const r = await api<{ label: { id: string } }>(`/api/w/${slug}/labels`, { body: { name } }); setName(""); setOn(false); onCreated(r.label.id); } }} /></span>;
}
