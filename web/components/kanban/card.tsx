"use client";
import { AlertTriangle, CalendarDays, Link2Off, ListChecks, MessageSquare } from "lucide-react";
import { Avatar, Badge } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import type { Priority, Task } from "@/lib/kanban-types";

export const PRIORITY_LABEL: Record<Priority, string> = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" };
export const PRIORITY_TONE: Record<Priority, "danger" | "warn" | "neutral" | "accent"> = { urgent: "danger", high: "warn", medium: "neutral", low: "neutral" };
const PRIORITY_MARK: Record<Priority, string> = { urgent: "!!!", high: "!!", medium: "!", low: "–" };

export function PriorityBadge({ p }: { p: Priority }) {
  return <Badge tone={PRIORITY_TONE[p]}><span aria-hidden>{PRIORITY_MARK[p]}</span>{PRIORITY_LABEL[p]}</Badge>;
}
export function DueBadge({ task }: { task: Task }) {
  if (!task.dueDate) return null;
  const d = new Date(task.dueDate + "T00:00:00");
  const text = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return task.overdue
    ? <Badge tone="danger"><AlertTriangle size={11} aria-hidden /> Overdue · {text}</Badge>
    : <Badge><CalendarDays size={11} aria-hidden /> {text}</Badge>;
}
export function Assignees({ task, max = 3 }: { task: Task; max?: number }) {
  if (!task.assignees.length) return <span className="text-xs text-fg-subtle">Unassigned</span>;
  return (
    <span className="flex items-center" aria-label={`Assigned to ${task.assignees.map((a) => a.name).join(", ")}`}>
      <span className="flex -space-x-1.5">{task.assignees.slice(0, max).map((a) => <span key={a.id} className="rounded-full ring-2 ring-bg"><Avatar name={a.name} size={22} /></span>)}</span>
      {task.assignees.length > max && <span className="ml-1 text-xs text-fg-subtle">+{task.assignees.length - max}</span>}
    </span>
  );
}

export function TaskCard({ task, dragging, onOpen }: { task: Task; dragging?: boolean; onOpen?: () => void }) {
  const openBlockers = task.blockedBy.filter((b) => !b.done);
  return (
    <div className={cn("select-none rounded-md border bg-bg p-2.5 text-left shadow-[0_1px_0_rgb(0_0_0/0.03)]", dragging ? "border-accent shadow-lg" : "border-line hover:border-line-strong", task.overdue && "border-l-2 border-l-danger")}
      onDoubleClick={onOpen}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] text-fg-subtle">#{task.number}{task.workstream ? ` · ${task.workstream}` : ""}</span>
        <PriorityBadge p={task.priority} />
      </div>
      <div className="mt-1 text-[13px] font-medium leading-snug">{task.title}</div>
      {task.labels.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{task.labels.map((l) => <Badge key={l.id} tone="accent">{l.name}</Badge>)}</div>}
      {openBlockers.length > 0 && <div className="mt-1.5 flex items-center gap-1 text-xs text-warn"><Link2Off size={12} aria-hidden /> Blocked by {openBlockers.map((b) => "#" + b.number).join(", ")}</div>}
      <div className="mt-2 flex items-center justify-between gap-2">
        <Assignees task={task} />
        <div className="flex items-center gap-2 text-xs text-fg-subtle">
          {task.subtaskTotal > 0 && <span className="flex items-center gap-0.5" title="Subtasks done"><ListChecks size={12} aria-hidden />{task.subtaskDone}/{task.subtaskTotal}</span>}
          {task.commentCount > 0 && <span className="flex items-center gap-0.5" title="Comments"><MessageSquare size={12} aria-hidden />{task.commentCount}</span>}
        </div>
      </div>
      {task.dueDate && <div className="mt-1.5"><DueBadge task={task} /></div>}
    </div>
  );
}
