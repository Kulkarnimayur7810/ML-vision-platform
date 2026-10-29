export type Priority = "urgent" | "high" | "medium" | "low";
export const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low"];
export type ColumnKind = "backlog" | "active" | "blocked" | "done";
export type Person = { id: string; name: string };
export type Column = { id: string; name: string; position: number; kind: ColumnKind; wipLimit: number | null };
export type Label = { id: string; name: string; color: string };
export type Task = {
  id: string; number: number; title: string; description: string; columnId: string; position: number;
  priority: Priority; workstream: string | null; startDate: string | null; dueDate: string | null;
  createdBy: Person | null; parentId: string | null; version: number; archivedAt: string | null; completedAt: string | null;
  createdAt: string; updatedAt: string;
  assignees: Person[]; labels: Label[]; subtaskTotal: number; subtaskDone: number; commentCount: number;
  blockedBy: { id: string; number: number; title: string; done: boolean }[];
  overdue: boolean; done: boolean;
};
export type Board = { columns: Column[]; tasks: Task[]; labels: Label[]; members: (Person & { role: string })[] };

export type Filters = {
  q?: string; assignee?: string[]; unassigned?: boolean; priority?: Priority[]; label?: string[]; creator?: string;
  workstream?: string; overdue?: boolean; blocked?: boolean; due?: "week" | "none"; status?: string[]; completed?: boolean;
};

export function filtersFromParams(p: URLSearchParams): Filters {
  const list = (k: string) => p.get(k)?.split(",").filter(Boolean);
  const f: Filters = {};
  if (p.get("q")) f.q = p.get("q")!;
  if (list("assignee")?.length) f.assignee = list("assignee");
  if (p.get("unassigned") === "1") f.unassigned = true;
  if (list("priority")?.length) f.priority = list("priority") as Priority[];
  if (list("label")?.length) f.label = list("label");
  if (p.get("creator")) f.creator = p.get("creator")!;
  if (p.get("workstream")) f.workstream = p.get("workstream")!;
  if (p.get("overdue") === "1") f.overdue = true;
  if (p.get("blocked") === "1") f.blocked = true;
  if (p.get("due") === "week" || p.get("due") === "none") f.due = p.get("due") as "week" | "none";
  if (list("status")?.length) f.status = list("status");
  if (p.get("completed") === "1") f.completed = true;
  return f;
}
export function filtersToParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.assignee?.length) p.set("assignee", f.assignee.join(","));
  if (f.unassigned) p.set("unassigned", "1");
  if (f.priority?.length) p.set("priority", f.priority.join(","));
  if (f.label?.length) p.set("label", f.label.join(","));
  if (f.creator) p.set("creator", f.creator);
  if (f.workstream) p.set("workstream", f.workstream);
  if (f.overdue) p.set("overdue", "1");
  if (f.blocked) p.set("blocked", "1");
  if (f.due) p.set("due", f.due);
  if (f.status?.length) p.set("status", f.status.join(","));
  if (f.completed) p.set("completed", "1");
  return p;
}

/** Client+server shared predicate so the board, list and tests agree. `me` resolves the literal "me". */
export function matches(t: Task, f: Filters, me: string): boolean {
  const r = (id: string) => (id === "me" ? me : id);
  if (f.q) {
    const q = f.q.trim().toLowerCase().replace(/^#/, "");
    if (!(t.title.toLowerCase().includes(q) || String(t.number) === q)) return false;
  }
  if (f.assignee?.length && !t.assignees.some((a) => f.assignee!.map(r).includes(a.id))) return false;
  if (f.unassigned && t.assignees.length) return false;
  if (f.priority?.length && !f.priority.includes(t.priority)) return false;
  if (f.label?.length && !t.labels.some((l) => f.label!.includes(l.id))) return false;
  if (f.creator && t.createdBy?.id !== r(f.creator)) return false;
  if (f.workstream && t.workstream !== f.workstream) return false;
  if (f.overdue && !t.overdue) return false;
  if (f.blocked && !t.blockedBy.some((b) => !b.done)) return false;
  if (f.due === "none" && t.dueDate) return false;
  if (f.due === "week") {
    if (!t.dueDate) return false;
    const d = Date.parse(t.dueDate + "T00:00:00Z"), now = Date.now();
    if (d > now + 7 * 864e5 || d < now - 864e5) return false;
  }
  if (f.status?.length && !f.status.includes(t.columnId)) return false;
  if (f.completed && !t.done) return false;
  return true;
}
