"use client";
import { useMemo, useRef, useState } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, useDroppable, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import { TaskCard } from "./card";
import { cn } from "@/lib/cn";
import type { Column, Task } from "@/lib/kanban-types";

type Layout = Record<string, string[]>;

function SortableCard({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { type: "task" } });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      {...attributes} {...listeners} role="button" aria-roledescription="draggable task" aria-label={`Task ${task.number}: ${task.title}. Press Enter to open, Space to pick up and move.`}
      onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onOpen(); } else listeners?.onKeyDown?.(e as never); }}
      className="cursor-grab touch-manipulation rounded-md active:cursor-grabbing" data-testid={`card-${task.number}`}>
      <TaskCard task={task} />
    </div>
  );
}

function ColumnView({ col, ids, byId, onOpen, onAdd, canCreate }: { col: Column; ids: string[]; byId: Map<string, Task>; onOpen: (t: Task) => void; onAdd: () => void; canCreate: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${col.id}`, data: { type: "column", columnId: col.id } });
  const over = col.wipLimit != null && ids.length > col.wipLimit;
  return (
    <section aria-label={`${col.name} column, ${ids.length} tasks`} className="flex w-72 shrink-0 flex-col rounded-lg bg-subtle" data-testid={`col-${col.name}`}>
      <header className="flex items-center justify-between px-3 py-2">
        <h3 className="text-[13px] font-semibold">{col.name} <span className={cn("ml-1 font-normal", over ? "text-danger" : "text-fg-subtle")}>{ids.length}{col.wipLimit != null ? `/${col.wipLimit}` : ""}</span></h3>
        {canCreate && <button aria-label={`Add task to ${col.name}`} onClick={onAdd} className="rounded p-1 text-fg-subtle hover:bg-hover hover:text-fg cursor-pointer"><Plus size={15} /></button>}
      </header>
      <div ref={setNodeRef} className={cn("flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2", isOver && "bg-accent-soft/50 rounded-b-lg")}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ids.map((id) => { const t = byId.get(id); return t ? <SortableCard key={id} task={t} onOpen={() => onOpen(t)} /> : null; })}
        </SortableContext>
        {ids.length === 0 && <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-xs text-fg-subtle">No tasks here</p>}
      </div>
    </section>
  );
}

export function Board({ columns, tasks, onOpen, onAdd, onMove, canCreate }: {
  columns: Column[]; tasks: Task[]; onOpen: (t: Task) => void; onAdd: (columnId: string) => void; canCreate: boolean;
  onMove: (t: Task, columnId: string, beforeId: string | null, afterId: string | null) => void;
}) {
  const base = useMemo<Layout>(() => {
    const l: Layout = Object.fromEntries(columns.map((c) => [c.id, []]));
    for (const t of tasks) l[t.columnId]?.push(t.id);
    return l;
  }, [columns, tasks]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const [drag, setDrag] = useState<Layout | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const startCol = useRef<string | null>(null);
  const layout = drag ?? base;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] } }),
  );
  const findCol = (l: Layout, id: string) => (id.startsWith("col:") ? id.slice(4) : Object.keys(l).find((c) => l[c].includes(id)));

  function onStart(e: DragStartEvent) { setActiveId(String(e.active.id)); setDrag(structuredClone(base)); startCol.current = findCol(base, String(e.active.id)) ?? null; }
  function onOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over || !drag) return;
    const a = String(active.id), o = String(over.id);
    const from = findCol(drag, a), to = findCol(drag, o);
    if (!from || !to || from === to) return;
    setDrag((d) => {
      if (!d) return d;
      const next: Layout = { ...d, [from]: d[from].filter((x) => x !== a) };
      const target = [...d[to]];
      const idx = o.startsWith("col:") ? target.length : Math.max(0, target.indexOf(o));
      target.splice(idx, 0, a);
      next[to] = target;
      return next;
    });
  }
  function onEnd(e: DragEndEvent) {
    const a = String(e.active.id);
    let final = drag ?? base;
    const over = e.over ? String(e.over.id) : null;
    if (over && !over.startsWith("col:")) {
      const c = findCol(final, a), oc = findCol(final, over);
      if (c && oc && c === oc) {
        const arr = final[c], oldI = arr.indexOf(a), newI = arr.indexOf(over);
        if (oldI !== newI && oldI >= 0 && newI >= 0) { const copy = [...arr]; copy.splice(oldI, 1); copy.splice(newI, 0, a); final = { ...final, [c]: copy }; }
      }
    }
    setDrag(null); setActiveId(null);
    const col = findCol(final, a);
    const task = byId.get(a);
    if (!col || !task) return;
    const arr = final[col], i = arr.indexOf(a);
    const unchanged = col === startCol.current && base[col].indexOf(a) === i;
    if (unchanged) return;
    onMove(task, col, arr[i + 1] ?? null, i > 0 ? arr[i - 1] : null);
  }
  const active = activeId ? byId.get(activeId) : null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onStart} onDragOver={onOver} onDragEnd={onEnd} onDragCancel={() => { setDrag(null); setActiveId(null); }}
      accessibility={{ announcements: {
        onDragStart: ({ active }) => `Picked up task ${byId.get(String(active.id))?.title ?? ""}.`,
        onDragOver: ({ over }) => over ? `Over ${over.id.toString().startsWith("col:") ? columns.find((c) => "col:" + c.id === over.id)?.name : byId.get(String(over.id))?.title}.` : "Not over a column.",
        onDragEnd: ({ active }) => `Dropped task ${byId.get(String(active.id))?.title ?? ""}.`,
        onDragCancel: () => "Move cancelled.",
      } }}>
      <div className="flex h-full gap-3 overflow-x-auto p-3 md:p-4" data-ready="true" data-testid="board">
        {columns.map((c) => <ColumnView key={c.id} col={c} ids={layout[c.id] ?? []} byId={byId} onOpen={onOpen} onAdd={() => onAdd(c.id)} canCreate={canCreate} />)}
      </div>
      <DragOverlay>{active ? <TaskCard task={active} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}
