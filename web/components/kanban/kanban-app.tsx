"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Bookmark, Columns3, Plus, Search } from "lucide-react";
import { Board } from "./board";
import { TaskList } from "./list";
import { Workload } from "./workload";
import { TaskDrawer } from "./drawer";
import { ColumnsDialog, CreateTaskDialog } from "./dialogs";
import { Alert, Button, Input, Select } from "@/components/ui/form";
import { api, ApiError, fetcher } from "@/lib/client/api";
import { filtersFromParams, filtersToParams, matches, PRIORITIES, type Board as BoardData, type Task } from "@/lib/kanban-types";
import { can, type Role } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { PRIORITY_LABEL } from "./card";

const VIEWS = [["board", "Board"], ["list", "List"], ["mine", "My tasks"], ["overdue", "Overdue"], ["done", "Completed"], ["workload", "Workload"]] as const;
type View = (typeof VIEWS)[number][0];
type SavedView = { id: string; name: string; query: string; shared: boolean; mine: boolean };

export function KanbanApp({ slug, role, me }: { slug: string; role: Role; me: string }) {
  const router = useRouter(); const pathname = usePathname(); const params = useSearchParams();
  const { data: board, error, mutate } = useSWR<BoardData>(`/api/w/${slug}/board`, fetcher, { refreshInterval: 8000, revalidateOnFocus: true });
  const { data: views, mutate: mutateViews } = useSWR<{ views: SavedView[] }>(`/api/w/${slug}/views`, fetcher);
  const view = (VIEWS.find((v) => v[0] === params.get("view"))?.[0] ?? "board") as View;
  const taskNo = Number(params.get("task")) || null;
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const [overrides, setOverrides] = useState<Record<string, { columnId: string; position: number }>>({});
  const [toast, setToast] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [createFor, setCreateFor] = useState<string | null | undefined>(undefined);
  const [cols, setCols] = useState(false);
  const [inflight] = useState(() => new Set<string>());

  // router.replace is asynchronous. Several quick changes (clear filters, then type in search) must each build on the
  // *latest* URL we asked for, not on the last one React has rendered — otherwise a stale value is written back.
  const latest = useRef(params.toString()); const pushed = useRef(new Set<string>());
  useEffect(() => {
    const cur = params.toString();
    if (cur === latest.current) { pushed.current.clear(); return; }
    if (pushed.current.has(cur)) return;      // an intermediate state of our own navigation: keep the newer one
    latest.current = cur; pushed.current.clear(); // external navigation (back button, saved view, link)
  }, [params]);
  const setParams = useCallback((mut: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(latest.current); mut(p);
    const s = p.toString(); latest.current = s; pushed.current.add(s);
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [pathname, router]);
  const setFilters = (patch: Partial<typeof filters>) => setParams((p) => {
    const next = filtersToParams({ ...filtersFromParams(p), ...patch });
    for (const k of ["q", "assignee", "unassigned", "priority", "label", "creator", "workstream", "overdue", "blocked", "due", "status", "completed"]) p.delete(k);
    next.forEach((v, k) => p.set(k, v));
  });

  const allTasks = useMemo(() => (board?.tasks ?? []).map((t) => (overrides[t.id] ? { ...t, ...overrides[t.id] } : t)).sort((a, b) => a.position - b.position), [board, overrides]);
  const visible = useMemo(() => {
    const f = view === "mine" ? { ...filters, assignee: ["me"] } : filters;
    return allTasks.filter((t) => matches(t, f, me)
      && (view !== "overdue" || t.overdue) && (view !== "done" || t.done) && (view !== "mine" || !t.done));
  }, [allTasks, filters, view, me]);

  async function onMove(t: Task, columnId: string, beforeId: string | null, afterId: string | null) {
    if (inflight.has(t.id)) return;
    inflight.add(t.id);
    const cols = (board?.columns ?? []).length;
    const colTasks = allTasks.filter((x) => x.columnId === columnId && x.id !== t.id);
    const pos = (id: string | null) => colTasks.find((x) => x.id === id)?.position;
    const b = pos(beforeId), a = pos(afterId);
    const position = b !== undefined && a !== undefined ? (a + b) / 2 : b !== undefined ? b - 512 : a !== undefined ? a + 512 : (colTasks.at(-1)?.position ?? 0) + 1024;
    setOverrides((o) => ({ ...o, [t.id]: { columnId, position } }));
    try {
      await api(`/api/w/${slug}/tasks/${t.id}/move`, { body: { version: t.version, columnId, beforeId, afterId } });
      await mutate();
    } catch (e) {
      setToast({ kind: "error", text: e instanceof ApiError && e.code === "conflict" ? "Someone else changed that task — the board was refreshed." : `Couldn't move task: ${(e as Error).message}` });
      await mutate();
    } finally {
      inflight.delete(t.id); void cols;
      setOverrides((o) => { const { [t.id]: _, ...rest } = o; return rest; });
    }
  }

  if (error) return <div className="p-4"><Alert>{(error as Error).message}</Alert></div>;
  if (!board) return <p className="p-4 text-sm text-fg-subtle" data-testid="loading">Loading board…</p>;
  const canCreate = can(role, "tasks.create");
  const canEditAny = can(role, "tasks.edit_any");
  const filterCount = Object.keys(Object.fromEntries(filtersToParams(filters))).length;
  const open = (t: { number: number }) => setParams((p) => p.set("task", String(t.number)));
  const hasTasks = board.tasks.length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-line px-3 py-2 md:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-2 text-base font-semibold">Team Kanban</h1>
          <div role="tablist" aria-label="Views" className="flex flex-wrap gap-0.5 rounded-md bg-muted p-0.5">
            {VIEWS.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={view === k} onClick={() => setParams((p) => (k === "board" ? p.delete("view") : p.set("view", k)))}
                className={cn("rounded px-2.5 py-1 text-[13px] cursor-pointer", view === k ? "bg-bg font-medium shadow-sm" : "text-fg-muted hover:text-fg")}>{label}</button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {can(role, "board.configure") && <Button size="sm" onClick={() => setCols(true)}><Columns3 size={14} />Columns</Button>}
            {canCreate && <Button size="sm" variant="primary" onClick={() => setCreateFor(null)}><Plus size={14} />Create task</Button>}
          </div>
        </div>
        {view !== "workload" && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
            <label className="relative"><span className="sr-only">Search tasks</span><Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle" aria-hidden />
              <Input className="h-8 w-48 pl-7 text-[13px]" placeholder="Search title or #id" value={filters.q ?? ""} onChange={(e) => setFilters({ q: e.target.value || undefined })} /></label>
            <Select aria-label="Filter by assignee" className="h-8 w-40 text-[13px]" value={filters.unassigned ? "none" : filters.assignee?.[0] ?? ""} onChange={(e) => setFilters({ assignee: e.target.value && e.target.value !== "none" ? [e.target.value] : undefined, unassigned: e.target.value === "none" || undefined })}>
              <option value="">Anyone</option><option value="me">Assigned to me</option><option value="none">Unassigned</option>
              {board.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
            <Select aria-label="Filter by creator" className="h-8 w-36 text-[13px]" value={filters.creator ?? ""} onChange={(e) => setFilters({ creator: e.target.value || undefined })}>
              <option value="">Any creator</option><option value="me">Created by me</option>{board.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
            <Select aria-label="Filter by priority" className="h-8 w-32 text-[13px]" value={filters.priority?.[0] ?? ""} onChange={(e) => setFilters({ priority: e.target.value ? [e.target.value as never] : undefined })}>
              <option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </Select>
            {board.labels.length > 0 && <Select aria-label="Filter by label" className="h-8 w-32 text-[13px]" value={filters.label?.[0] ?? ""} onChange={(e) => setFilters({ label: e.target.value ? [e.target.value] : undefined })}><option value="">Any label</option>{board.labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}
            <Select aria-label="Filter by due date" className="h-8 w-32 text-[13px]" value={filters.due ?? ""} onChange={(e) => setFilters({ due: (e.target.value || undefined) as never })}><option value="">Any due date</option><option value="week">Due within 7 days</option><option value="none">No due date</option></Select>
            <label className="flex items-center gap-1 text-[13px]"><input type="checkbox" checked={!!filters.overdue} onChange={(e) => setFilters({ overdue: e.target.checked || undefined })} />Overdue</label>
            <label className="flex items-center gap-1 text-[13px]"><input type="checkbox" checked={!!filters.blocked} onChange={(e) => setFilters({ blocked: e.target.checked || undefined })} />Blocked</label>
            {filterCount > 0 && <Button size="sm" variant="ghost" onClick={() => setFilters({ q: undefined, assignee: undefined, unassigned: undefined, priority: undefined, label: undefined, creator: undefined, workstream: undefined, overdue: undefined, blocked: undefined, due: undefined, status: undefined, completed: undefined })}>Clear filters</Button>}
            <Select aria-label="Saved views" className="h-8 w-40 text-[13px]" value="" onChange={(e) => { const v = views?.views.find((x) => x.id === e.target.value); if (v) router.replace(v.query ? `${pathname}?${v.query}` : pathname); }}>
              <option value="">Saved views…</option>{views?.views.map((v) => <option key={v.id} value={v.id}>{v.name}{v.shared ? " (shared)" : ""}</option>)}
            </Select>
            {filterCount > 0 && <Button size="sm" variant="ghost" onClick={async () => { const n = window.prompt("Name this view"); if (!n) return; const q = new URLSearchParams(params.toString()); q.delete("task"); await api(`/api/w/${slug}/views`, { body: { name: n, query: q.toString(), shared: false } }); mutateViews(); setToast({ kind: "ok", text: `Saved view “${n}”` }); }}><Bookmark size={14} />Save view</Button>}
          </div>
        )}
        {toast && <div className="flex items-center justify-between gap-2"><Alert kind={toast.kind}>{toast.text}</Alert><button className="text-xs underline cursor-pointer" onClick={() => setToast(null)}>Dismiss</button></div>}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {view === "board" && (!hasTasks
          ? <div className="mx-auto mt-16 max-w-sm text-center"><h2 className="text-base font-semibold">Your board is empty</h2><p className="mt-1 text-sm text-fg-muted">Create the first task — for example “Collect 200 images of crushed bottles” — and assign it to a teammate.</p>
            {canCreate && <Button variant="primary" className="mt-4" onClick={() => setCreateFor(null)}>Create the first task</Button>}</div>
          : <Board columns={board.columns} tasks={visible} onOpen={open} onAdd={(c) => setCreateFor(c)} onMove={onMove} canCreate={canCreate} />)}
        {view === "list" && <TaskList tasks={visible} board={board} onOpen={open} empty="No tasks match these filters." />}
        {view === "mine" && <TaskList tasks={visible} board={board} onOpen={open} empty="Nothing assigned to you right now." />}
        {view === "overdue" && <TaskList tasks={visible} board={board} onOpen={open} empty="No overdue tasks. Nice." />}
        {view === "done" && <TaskList tasks={visible} board={board} onOpen={open} empty="No completed tasks yet." />}
        {view === "workload" && <Workload slug={slug} />}
      </div>

      <CreateTaskDialog slug={slug} board={board} open={createFor !== undefined} columnId={createFor} me={me} onClose={() => setCreateFor(undefined)}
        onCreated={async (n) => { setCreateFor(undefined); await mutate(); setToast({ kind: "ok", text: `Created task #${n}` }); }} />
      <ColumnsDialog slug={slug} board={board} open={cols} onClose={() => setCols(false)} onChanged={() => mutate()} />
      <TaskDrawer slug={slug} number={taskNo} board={board} canEditAny={canEditAny} me={me} onClose={() => setParams((p) => p.delete("task"))} refresh={() => mutate()} />
    </div>
  );
}
