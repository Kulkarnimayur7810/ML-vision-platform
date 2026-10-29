"use client";
import { Badge } from "@/components/ui/form";
import { Assignees, DueBadge, PriorityBadge } from "./card";
import type { Board, Task } from "@/lib/kanban-types";

export function TaskList({ tasks, board, onOpen, empty }: { tasks: Task[]; board: Board; onOpen: (t: Task) => void; empty: string }) {
  if (!tasks.length) return <p className="m-4 rounded-lg border border-dashed border-line p-8 text-center text-sm text-fg-subtle">{empty}</p>;
  const col = (id: string) => board.columns.find((c) => c.id === id)?.name ?? "";
  return (
    <div className="overflow-x-auto p-3 md:p-4">
      <table className="w-full min-w-[720px] text-left text-[13px]" data-testid="task-list">
        <thead className="text-xs text-fg-subtle"><tr><th className="py-1.5 pr-3 font-medium">Task</th><th className="pr-3 font-medium">Status</th><th className="pr-3 font-medium">Priority</th><th className="pr-3 font-medium">Assignees</th><th className="font-medium">Due</th></tr></thead>
        <tbody className="divide-y divide-line">
          {tasks.map((t) => (
            <tr key={t.id} className="hover:bg-hover">
              <td className="py-2 pr-3"><button onClick={() => onOpen(t)} className="text-left hover:underline cursor-pointer"><span className="text-fg-subtle">#{t.number}</span> {t.title}</button></td>
              <td className="pr-3"><Badge tone={t.done ? "ok" : "neutral"}>{col(t.columnId)}</Badge></td>
              <td className="pr-3"><PriorityBadge p={t.priority} /></td>
              <td className="pr-3"><Assignees task={t} /></td>
              <td>{t.dueDate ? <DueBadge task={t} /> : <span className="text-fg-subtle">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
