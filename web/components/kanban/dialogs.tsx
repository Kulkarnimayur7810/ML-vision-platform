"use client";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Avatar, Button, Field, Input, Select } from "@/components/ui/form";
import { api } from "@/lib/client/api";
import { PRIORITIES, type Board, type Priority } from "@/lib/kanban-types";
import { PRIORITY_LABEL } from "./card";

export function CreateTaskDialog({ slug, board, open, columnId, me, onClose, onCreated }: { slug: string; board: Board; open: boolean; columnId?: string | null; me: string; onClose: () => void; onCreated: (n: number) => void }) {
  const [title, setTitle] = useState(""); const [col, setCol] = useState(""); const [priority, setPriority] = useState<Priority>("medium");
  const [assignees, setAssignees] = useState<string[]>([]); const [due, setDue] = useState("");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const columnValue = col || columnId || board.columns.find((c) => c.kind === "backlog")?.id || board.columns[0]?.id || "";
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await api<{ task: { number: number } }>(`/api/w/${slug}/tasks`, { body: { title, columnId: columnValue, priority, assigneeIds: assignees, dueDate: due || null } });
      setTitle(""); setAssignees([]); setDue(""); setCol(""); onCreated(r.task.number);
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Create task">
      <form onSubmit={submit} className="space-y-3">
        {err && <Alert>{err}</Alert>}
        <Field label="Title" htmlFor="c-title"><Input id="c-title" autoFocus required value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Collect 200 images of crushed bottles" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Column" htmlFor="c-col"><Select id="c-col" value={columnValue} onChange={(e) => setCol(e.target.value)}>{board.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Priority" htmlFor="c-pri"><Select id="c-pri" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</Select></Field>
        </div>
        <Field label="Due date (optional)" htmlFor="c-due"><Input id="c-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="Assign to">
          <div className="flex flex-wrap gap-1.5">
            {board.members.map((m) => (
              <button type="button" key={m.id} aria-pressed={assignees.includes(m.id)} onClick={() => setAssignees((a) => a.includes(m.id) ? a.filter((x) => x !== m.id) : [...a, m.id])}
                className={`flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs cursor-pointer ${assignees.includes(m.id) ? "border-accent bg-accent-soft" : "border-line hover:bg-hover"}`}>
                <Avatar name={m.name} size={20} />{m.name}{m.id === me ? " (me)" : ""}
              </button>
            ))}
          </div>
        </Field>
        <div className="flex justify-end gap-2 pt-1"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={busy || !title.trim()}>Create task</Button></div>
      </form>
    </Dialog>
  );
}

export function ColumnsDialog({ slug, board, open, onClose, onChanged }: { slug: string; board: Board; open: boolean; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState(""); const [err, setErr] = useState<string | null>(null);
  const call = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); onChanged(); } catch (e) { setErr((e as Error).message); } };
  return (
    <Dialog open={open} onClose={onClose} title="Configure columns" wide>
      <div className="space-y-3">
        {err && <Alert>{err}</Alert>}
        <ul className="space-y-1.5">
          {board.columns.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2">
              <button aria-label={`Move ${c.name} left`} disabled={i === 0} className="rounded p-1.5 hover:bg-hover disabled:opacity-30 cursor-pointer" onClick={() => call(() => api(`/api/w/${slug}/columns/${c.id}`, { method: "PATCH", body: { move: "left" } }))}><ArrowLeft size={14} /></button>
              <button aria-label={`Move ${c.name} right`} disabled={i === board.columns.length - 1} className="rounded p-1.5 hover:bg-hover disabled:opacity-30 cursor-pointer" onClick={() => call(() => api(`/api/w/${slug}/columns/${c.id}`, { method: "PATCH", body: { move: "right" } }))}><ArrowRight size={14} /></button>
              <Input aria-label={`Name of column ${c.name}`} defaultValue={c.name} maxLength={40} onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && call(() => api(`/api/w/${slug}/columns/${c.id}`, { method: "PATCH", body: { name: e.target.value } }))} />
              <Select aria-label={`Type of column ${c.name}`} className="w-32" value={c.kind} onChange={(e) => call(() => api(`/api/w/${slug}/columns/${c.id}`, { method: "PATCH", body: { kind: e.target.value } }))}>
                <option value="backlog">Backlog</option><option value="active">Active</option><option value="blocked">Blocked</option><option value="done">Done</option>
              </Select>
              <Input aria-label={`Work-in-progress limit for ${c.name}`} type="number" min={1} className="w-20" placeholder="WIP" defaultValue={c.wipLimit ?? ""} onBlur={(e) => call(() => api(`/api/w/${slug}/columns/${c.id}`, { method: "PATCH", body: { wipLimit: e.target.value ? Number(e.target.value) : null } }))} />
              <button aria-label={`Remove column ${c.name}`} className="rounded p-1.5 text-danger hover:bg-hover cursor-pointer" onClick={() => call(() => api(`/api/w/${slug}/columns/${c.id}`, { method: "DELETE" }))}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-fg-subtle">"Done" columns mark tasks complete. A column must be empty before it can be removed.</p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) call(async () => { await api(`/api/w/${slug}/columns`, { body: { name, kind: "active" } }); setName(""); }); }}>
          <Input aria-label="New column name" placeholder="New column name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" disabled={!name.trim()}>Add column</Button>
        </form>
      </div>
    </Dialog>
  );
}
