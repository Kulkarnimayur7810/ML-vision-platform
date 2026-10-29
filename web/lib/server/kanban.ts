import type { Sql } from "../db";
import { sql, tx } from "../db";
import { AppError, badRequest, conflict, forbidden, notFound } from "../errors";
import { can, type Role } from "../authz";
import type { Board, Column, Priority, Task } from "../kanban-types";
import { log, notify } from "./activity";

type Actor = { id: string; role: Role; workspaceId: string; slug: string };

const TASK_SELECT = (db: Sql, workspaceId: string, where: ReturnType<Sql>) => db`
  select t.id, t.number, t.title, t.description, t.column_id, t.position, t.priority, t.workstream,
    to_char(t.start_date,'YYYY-MM-DD') start_date, to_char(t.due_date,'YYYY-MM-DD') due_date,
    t.parent_id, t.version, t.archived_at, t.completed_at, t.created_at, t.updated_at,
    c.kind as col_kind,
    case when cu.id is null then null else jsonb_build_object('id', cu.id, 'name', cu.display_name) end as creator,
    coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.display_name) order by u.display_name) from task_assignees a join users u on u.id = a.user_id where a.task_id = t.id), '[]') as assignees,
    coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'color', l.color) order by l.name) from task_labels tl join labels l on l.id = tl.label_id where tl.task_id = t.id), '[]') as labels,
    (select count(*)::int from tasks s where s.parent_id = t.id and s.archived_at is null) as sub_total,
    (select count(*)::int from tasks s join board_columns sc on sc.id = s.column_id where s.parent_id = t.id and s.archived_at is null and sc.kind = 'done') as sub_done,
    (select count(*)::int from task_comments k where k.task_id = t.id) as comment_count,
    coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'number', b.number, 'title', b.title, 'done', bc.kind = 'done')) from task_dependencies d join tasks b on b.id = d.depends_on join board_columns bc on bc.id = b.column_id where d.task_id = t.id and b.archived_at is null), '[]') as blocked_by
  from tasks t
  join board_columns c on c.id = t.column_id
  left join users cu on cu.id = t.created_by
  where t.workspace_id = ${workspaceId} and ${where}
  order by t.position`;

function shape(r: any): Task {
  const done = r.col_kind === "done";
  const due: string | null = r.due_date;
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: r.id, number: r.number, title: r.title, description: r.description, columnId: r.column_id, position: r.position,
    priority: r.priority, workstream: r.workstream, startDate: r.start_date, dueDate: due, createdBy: r.creator,
    parentId: r.parent_id, version: r.version, archivedAt: r.archived_at ? new Date(r.archived_at).toISOString() : null,
    completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
    assignees: r.assignees, labels: r.labels, subtaskTotal: r.sub_total, subtaskDone: r.sub_done, commentCount: r.comment_count,
    blockedBy: r.blocked_by, done, overdue: !!due && !done && due < today,
  };
}

export async function getBoard(workspaceId: string, includeArchived = false): Promise<Board> {
  const db = sql();
  const [cols, rows, labels, members] = await Promise.all([
    db`select id, name, position, kind, wip_limit from board_columns where workspace_id = ${workspaceId} and not archived order by position`,
    TASK_SELECT(db, workspaceId, includeArchived ? db`true` : db`t.archived_at is null`),
    db`select id, name, color from labels where workspace_id = ${workspaceId} order by name`,
    db`select u.id, u.display_name as name, m.role from workspace_members m join users u on u.id = m.user_id where m.workspace_id = ${workspaceId} and u.is_active order by u.display_name`,
  ]);
  return {
    columns: cols.map((c) => ({ id: c.id, name: c.name, position: c.position, kind: c.kind, wipLimit: c.wip_limit })) as Column[],
    tasks: rows.map(shape), labels: labels as any, members: members as any,
  };
}

export async function getTask(workspaceId: string, number: number): Promise<Task> {
  const db = sql();
  const [r] = await TASK_SELECT(db, workspaceId, db`t.number = ${number}`);
  if (!r) throw notFound("Task not found");
  return shape(r);
}

async function lockTask(tx: Sql, workspaceId: string, id: string) {
  const [t] = await tx`select t.*, c.kind as col_kind from tasks t join board_columns c on c.id = t.column_id where t.id = ${id} and t.workspace_id = ${workspaceId} for update of t`;
  if (!t) throw notFound("Task not found");
  return t;
}
async function assertMembers(tx: Sql, workspaceId: string, userIds: string[]) {
  if (!userIds.length) return;
  const rows = await tx`select user_id from workspace_members where workspace_id = ${workspaceId} and user_id in ${tx(userIds)}`;
  if (rows.length !== new Set(userIds).size) throw badRequest("You can only assign people who are members of this workspace.");
}
function assertCanEdit(a: Actor, t: { created_by?: string | null }, assigneeIds: string[]) {
  if (can(a.role, "tasks.edit_any")) return;
  if (!can(a.role, "tasks.edit")) throw forbidden();
  if (t.created_by === a.id || assigneeIds.includes(a.id)) return;
  throw forbidden("You can edit tasks you created or are assigned to.");
}
async function assigneeIds(tx: Sql, taskId: string) { return (await tx`select user_id from task_assignees where task_id = ${taskId}`).map((r) => r.user_id as string); }
const href = (a: Actor, n: number) => `/w/${a.slug}/kanban/tasks/${n}`;

export type NewTask = {
  title: string; description?: string; columnId?: string; priority?: Priority; assigneeIds?: string[]; labelIds?: string[];
  dueDate?: string | null; startDate?: string | null; workstream?: string | null; parentId?: string | null;
};

async function lastPosition(tx: Sql, columnId: string) {
  const [r] = await tx`select coalesce(max(position), 0) p from tasks where column_id = ${columnId} and archived_at is null`;
  return Number(r.p) + 1024;
}

export async function createTask(a: Actor, input: NewTask): Promise<Task> {
  if (!can(a.role, "tasks.create")) throw forbidden();
  const title = input.title.trim();
  if (!title) throw badRequest("Give the task a title.");
  const num = await tx(async (tx) => {
    const columnId = input.columnId ?? (await tx`select id from board_columns where workspace_id = ${a.workspaceId} and not archived order by (kind='backlog') desc, position limit 1`)[0]?.id;
    const [col] = await tx`select id, kind from board_columns where id = ${columnId} and workspace_id = ${a.workspaceId} and not archived`;
    if (!col) throw badRequest("Unknown column.");
    const ids = [...new Set(input.assigneeIds ?? [])];
    await assertMembers(tx, a.workspaceId, ids);
    if (input.parentId) {
      const [p] = await tx`select parent_id from tasks where id = ${input.parentId} and workspace_id = ${a.workspaceId}`;
      if (!p) throw badRequest("Parent task not found.");
      if (p.parent_id) throw badRequest("Subtasks can't have their own subtasks.");
    }
    if (input.labelIds?.length) {
      const ok = await tx`select id from labels where workspace_id = ${a.workspaceId} and id in ${tx(input.labelIds)}`;
      if (ok.length !== new Set(input.labelIds).size) throw badRequest("Unknown label.");
    }
    const [{ next_task }] = await tx`update workspace_counters set next_task = next_task + 1 where workspace_id = ${a.workspaceId} returning next_task - 1 as next_task`;
    const [t] = await tx`insert into tasks (workspace_id, number, title, description, column_id, position, priority, workstream, start_date, due_date, created_by, parent_id, completed_at)
      values (${a.workspaceId}, ${next_task}, ${title}, ${input.description ?? ""}, ${col.id}, ${await lastPosition(tx, col.id)}, ${input.priority ?? "medium"}, ${input.workstream ?? null}, ${input.startDate ?? null}, ${input.dueDate ?? null}, ${a.id}, ${input.parentId ?? null}, ${col.kind === "done" ? tx`now()` : null})
      returning id, number`;
    for (const u of ids) {
      await tx`insert into task_assignees (task_id, user_id) values (${t.id}, ${u})`;
      if (u !== a.id) await notify(tx, a.workspaceId, u, "assigned", `You were assigned #${t.number} ${title}`, href(a, t.number));
    }
    for (const l of input.labelIds ?? []) await tx`insert into task_labels (task_id, label_id) values (${t.id}, ${l}) on conflict do nothing`;
    await log(tx, a.workspaceId, a.id, "task.created", "task", t.id, `Created #${t.number} ${title}`);
    return t.number as number;
  });
  return getTask(a.workspaceId, num);
}

export type TaskPatch = {
  version: number; title?: string; description?: string; priority?: Priority; workstream?: string | null;
  dueDate?: string | null; startDate?: string | null; assigneeIds?: string[]; labelIds?: string[]; parentId?: string | null;
};

export async function updateTask(a: Actor, id: string, p: TaskPatch): Promise<Task> {
  const num = await tx(async (tx) => {
    const t = await lockTask(tx, a.workspaceId, id);
    const cur = await assigneeIds(tx, id);
    assertCanEdit(a, t, cur);
    if (t.version !== p.version) throw conflict("Someone else changed this task. Reload to see their changes.", { currentVersion: t.version });
    const changes: string[] = [];
    if (p.title !== undefined) { if (!p.title.trim()) throw badRequest("Title can't be empty."); if (p.title.trim() !== t.title) changes.push("title"); }
    if (p.priority && p.priority !== t.priority) changes.push(`priority → ${p.priority}`);
    if (p.dueDate !== undefined && (p.dueDate ?? null) !== (t.due_date ? t.due_date.toISOString?.().slice(0, 10) ?? String(t.due_date) : null)) changes.push("due date");
    if (p.description !== undefined && p.description !== t.description) changes.push("description");
    if (p.startDate !== undefined && p.startDate && p.dueDate !== undefined && p.dueDate && p.startDate > p.dueDate) throw badRequest("Start date must be before the due date.");
    await tx`update tasks set
      title = ${p.title !== undefined ? p.title.trim() : t.title},
      description = ${p.description ?? t.description},
      priority = ${p.priority ?? t.priority},
      workstream = ${p.workstream !== undefined ? p.workstream || null : t.workstream},
      due_date = ${p.dueDate !== undefined ? p.dueDate : t.due_date},
      start_date = ${p.startDate !== undefined ? p.startDate : t.start_date},
      version = version + 1, updated_at = now() where id = ${id}`;
    if (p.assigneeIds) {
      const next = [...new Set(p.assigneeIds)];
      await assertMembers(tx, a.workspaceId, next);
      const added = next.filter((u) => !cur.includes(u)), removed = cur.filter((u) => !next.includes(u));
      for (const u of removed) await tx`delete from task_assignees where task_id = ${id} and user_id = ${u}`;
      for (const u of added) {
        await tx`insert into task_assignees (task_id, user_id) values (${id}, ${u}) on conflict do nothing`;
        if (u !== a.id) await notify(tx, a.workspaceId, u, "assigned", `You were assigned #${t.number} ${t.title}`, href(a, t.number));
      }
      if (added.length || removed.length) {
        changes.push("assignees");
        const names = new Map((await tx`select id, display_name from users where id in ${tx([...added, ...removed])}`).map((u) => [u.id, u.display_name]));
        await log(tx, a.workspaceId, a.id, "task.assigned", "task", id, `#${t.number}: ${[...added.map((u) => "assigned " + names.get(u)), ...removed.map((u) => "unassigned " + names.get(u))].join(", ")}`);
      }
    }
    if (p.labelIds) {
      const ids = [...new Set(p.labelIds)];
      if (ids.length) { const ok = await tx`select id from labels where workspace_id = ${a.workspaceId} and id in ${tx(ids)}`; if (ok.length !== ids.length) throw badRequest("Unknown label."); }
      await tx`delete from task_labels where task_id = ${id}`;
      for (const l of ids) await tx`insert into task_labels (task_id, label_id) values (${id}, ${l})`;
      changes.push("labels");
    }
    if (p.parentId !== undefined) {
      if (p.parentId) {
        if (p.parentId === id) throw badRequest("A task can't be its own parent.");
        const [par] = await tx`select parent_id from tasks where id = ${p.parentId} and workspace_id = ${a.workspaceId}`;
        if (!par) throw badRequest("Parent task not found.");
        if (par.parent_id) throw badRequest("Subtasks can't have their own subtasks.");
        const [{ n }] = await tx`select count(*)::int n from tasks where parent_id = ${id}`;
        if (n) throw badRequest("This task has subtasks, so it can't become a subtask itself.");
      }
      await tx`update tasks set parent_id = ${p.parentId} where id = ${id}`;
      changes.push("parent");
    }
    const other = changes.filter((c) => c !== "assignees");
    if (other.length) await log(tx, a.workspaceId, a.id, "task.updated", "task", id, `Updated #${t.number} (${other.join(", ")})`);
    return t.number as number;
  });
  return getTask(a.workspaceId, num);
}

const GAP_MIN = 1e-6;
async function rebalance(tx: Sql, columnId: string) {
  const rows = await tx`select id from tasks where column_id = ${columnId} and archived_at is null order by position, created_at`;
  for (const [i, r] of rows.entries()) await tx`update tasks set position = ${(i + 1) * 1024} where id = ${r.id}`;
}

/** Move to a column; `beforeId`/`afterId` choose the slot, otherwise append. */
export async function moveTask(a: Actor, id: string, input: { version: number; columnId: string; beforeId?: string | null; afterId?: string | null }): Promise<Task> {
  const num = await tx(async (tx) => {
    const t = await lockTask(tx, a.workspaceId, id);
    assertCanEdit(a, t, await assigneeIds(tx, id));
    if (t.version !== input.version) throw conflict("Someone else changed this task. Reload to see their changes.", { currentVersion: t.version });
    const [col] = await tx`select id, name, kind from board_columns where id = ${input.columnId} and workspace_id = ${a.workspaceId} and not archived`;
    if (!col) throw badRequest("Unknown column.");
    const pos = async (): Promise<number> => {
      const neighbor = async (nid: string) => { const [n] = await tx`select position from tasks where id = ${nid} and column_id = ${col.id} and archived_at is null and id <> ${id}`; return n ? Number(n.position) : null; };
      if (input.beforeId) {
        const b = await neighbor(input.beforeId);
        if (b !== null) {
          const [p] = await tx`select max(position) p from tasks where column_id = ${col.id} and archived_at is null and id <> ${id} and position < ${b}`;
          const prev = p.p === null ? 0 : Number(p.p);
          return (prev + b) / 2;
        }
      }
      if (input.afterId) {
        const af = await neighbor(input.afterId);
        if (af !== null) {
          const [n] = await tx`select min(position) p from tasks where column_id = ${col.id} and archived_at is null and id <> ${id} and position > ${af}`;
          return n.p === null ? af + 1024 : (af + Number(n.p)) / 2;
        }
      }
      const [r] = await tx`select coalesce(max(position), 0) p from tasks where column_id = ${col.id} and archived_at is null and id <> ${id}`;
      return Number(r.p) + 1024;
    };
    let position = await pos();
    const moved = t.column_id !== col.id;
    if (col.kind === "done" && moved) {
      const open = await tx`select b.number from task_dependencies d join tasks b on b.id = d.depends_on join board_columns bc on bc.id = b.column_id where d.task_id = ${id} and bc.kind <> 'done' and b.archived_at is null`;
      if (open.length) throw badRequest(`Blocked by unfinished ${open.map((o) => "#" + o.number).join(", ")}. Finish those first.`);
    }
    if (col.wip_limit) { /* reserved */ }
    await tx`update tasks set column_id = ${col.id}, position = ${position}, version = version + 1, updated_at = now(),
      completed_at = ${col.kind === "done" ? (t.col_kind === "done" ? t.completed_at : tx`now()`) : null} where id = ${id}`;
    const [{ gap }] = await tx`select coalesce(min(d), 1) gap from (select position - lag(position) over (order by position) d from tasks where column_id = ${col.id} and archived_at is null) x where d is not null`;
    if (Number(gap) < GAP_MIN || position <= 0) await rebalance(tx, col.id);
    if (moved) {
      const [from] = await tx`select name from board_columns where id = ${t.column_id}`;
      await log(tx, a.workspaceId, a.id, "task.moved", "task", id, `Moved #${t.number} ${t.title} from ${from.name} to ${col.name}`);
      for (const u of await assigneeIds(tx, id)) if (u !== a.id) await notify(tx, a.workspaceId, u, "status", `#${t.number} moved to ${col.name}`, href(a, t.number));
    }
    return t.number as number;
  });
  return getTask(a.workspaceId, num);
}

export async function archiveTask(a: Actor, id: string, archive: boolean) {
  await tx(async (tx) => {
    const t = await lockTask(tx, a.workspaceId, id);
    if (!can(a.role, "tasks.archive")) { assertCanEdit(a, t, await assigneeIds(tx, id)); if (t.created_by !== a.id) throw forbidden(); }
    await tx`update tasks set archived_at = ${archive ? tx`now()` : null}, version = version + 1, updated_at = now() where id = ${id}`;
    await log(tx, a.workspaceId, a.id, archive ? "task.archived" : "task.restored", "task", id, `${archive ? "Archived" : "Restored"} #${t.number} ${t.title}`);
  });
}

export async function addComment(a: Actor, taskId: string, body: string) {
  if (!can(a.role, "comments.create")) throw forbidden();
  const text = body.trim();
  if (!text) throw badRequest("Write a comment first.");
  if (text.length > 10000) throw badRequest("Comment is too long.");
  await tx(async (tx) => {
    const t = await lockTask(tx, a.workspaceId, taskId);
    await tx`insert into task_comments (task_id, author_id, body) values (${taskId}, ${a.id}, ${text})`;
    const targets = new Set([...(await assigneeIds(tx, taskId)), ...(t.created_by ? [t.created_by as string] : [])]);
    targets.delete(a.id);
    for (const u of targets) await notify(tx, a.workspaceId, u, "comment", `New comment on #${t.number} ${t.title}`, href(a, t.number));
    await log(tx, a.workspaceId, a.id, "task.commented", "task", taskId, `Commented on #${t.number} ${t.title}`);
  });
}
export async function listComments(workspaceId: string, taskId: string) {
  const rows = await sql()`select k.id, k.body, k.created_at, u.id as author_id, u.display_name from task_comments k join tasks t on t.id = k.task_id left join users u on u.id = k.author_id where k.task_id = ${taskId} and t.workspace_id = ${workspaceId} order by k.created_at`;
  return rows.map((r) => ({ id: Number(r.id), body: r.body as string, createdAt: new Date(r.created_at).toISOString(), author: r.author_id ? { id: r.author_id as string, name: r.display_name as string } : null }));
}
export async function taskActivity(workspaceId: string, taskId: string) {
  const rows = await sql()`select ac.id, ac.summary, ac.at, u.display_name from activity ac left join users u on u.id = ac.actor_id where ac.workspace_id = ${workspaceId} and ac.entity_type = 'task' and ac.entity_id = ${taskId} order by ac.at desc limit 50`;
  return rows.map((r) => ({ id: Number(r.id), summary: r.summary as string, at: new Date(r.at).toISOString(), actor: (r.display_name as string) ?? "System" }));
}

/** Add "task depends on blocker". Rejects cycles. */
export async function addDependency(a: Actor, taskId: string, blockerId: string) {
  if (taskId === blockerId) throw badRequest("A task can't depend on itself.");
  await tx(async (tx) => {
    const t = await lockTask(tx, a.workspaceId, taskId);
    assertCanEdit(a, t, await assigneeIds(tx, taskId));
    const [b] = await tx`select number from tasks where id = ${blockerId} and workspace_id = ${a.workspaceId}`;
    if (!b) throw badRequest("Blocking task not found.");
    const [cycle] = await tx`with recursive up as (select depends_on as id from task_dependencies where task_id = ${blockerId} union select d.depends_on from task_dependencies d join up on d.task_id = up.id) select 1 from up where id = ${taskId}`;
    if (cycle) throw badRequest(`That would create a circular dependency (#${b.number} already depends on #${t.number}).`);
    await tx`insert into task_dependencies (task_id, depends_on) values (${taskId}, ${blockerId}) on conflict do nothing`;
    await log(tx, a.workspaceId, a.id, "task.dependency", "task", taskId, `#${t.number} is now blocked by #${b.number}`);
  });
}
export async function removeDependency(a: Actor, taskId: string, blockerId: string) {
  await tx(async (tx) => {
    const t = await lockTask(tx, a.workspaceId, taskId);
    assertCanEdit(a, t, await assigneeIds(tx, taskId));
    await tx`delete from task_dependencies where task_id = ${taskId} and depends_on = ${blockerId}`;
  });
}

// ── Columns & labels ────────────────────────────────────────────────────────
export async function createColumn(a: Actor, name: string, kind: Column["kind"]) {
  if (!can(a.role, "board.configure")) throw forbidden();
  if (!name.trim()) throw badRequest("Give the column a name.");
  const [r] = await sql()`select coalesce(max(position),0)+1024 p from board_columns where workspace_id = ${a.workspaceId}`;
  await sql()`insert into board_columns (workspace_id, name, position, kind) values (${a.workspaceId}, ${name.trim()}, ${r.p}, ${kind})`;
}
export async function updateColumn(a: Actor, id: string, patch: { name?: string; kind?: Column["kind"]; wipLimit?: number | null }) {
  if (!can(a.role, "board.configure")) throw forbidden();
  const [c] = await sql()`select * from board_columns where id = ${id} and workspace_id = ${a.workspaceId}`;
  if (!c) throw notFound();
  await sql()`update board_columns set name = ${patch.name?.trim() || c.name}, kind = ${patch.kind ?? c.kind}, wip_limit = ${patch.wipLimit === undefined ? c.wip_limit : patch.wipLimit} where id = ${id}`;
}
export async function moveColumn(a: Actor, id: string, dir: "left" | "right") {
  if (!can(a.role, "board.configure")) throw forbidden();
  await tx(async (tx) => {
    const cols = await tx`select id, position from board_columns where workspace_id = ${a.workspaceId} and not archived order by position for update`;
    const i = cols.findIndex((c) => c.id === id);
    if (i < 0) throw notFound();
    const j = dir === "left" ? i - 1 : i + 1;
    if (j < 0 || j >= cols.length) return;
    await tx`update board_columns set position = ${cols[j].position} where id = ${cols[i].id}`;
    await tx`update board_columns set position = ${cols[i].position} where id = ${cols[j].id}`;
  });
}
export async function archiveColumn(a: Actor, id: string) {
  if (!can(a.role, "board.configure")) throw forbidden();
  const [{ n }] = await sql()`select count(*)::int n from tasks where column_id = ${id} and archived_at is null`;
  if (n) throw badRequest(`Move or archive the ${n} task${n > 1 ? "s" : ""} in this column first.`);
  const [{ left }] = await sql()`select count(*)::int as left from board_columns where workspace_id = ${a.workspaceId} and not archived and id <> ${id}`;
  if (!left) throw badRequest("A board needs at least one column.");
  await sql()`update board_columns set archived = true where id = ${id} and workspace_id = ${a.workspaceId}`;
}
export async function createLabel(a: Actor, name: string, color: string) {
  if (!can(a.role, "tasks.create")) throw forbidden();
  const n = name.trim();
  if (!n) throw badRequest("Give the label a name.");
  const [l] = await sql()`insert into labels (workspace_id, name, color) values (${a.workspaceId}, ${n}, ${color || "gray"}) on conflict (workspace_id, name) do update set name = excluded.name returning id, name, color`;
  return l;
}

// ── Workload ────────────────────────────────────────────────────────────────
export async function workload(workspaceId: string, sinceDays = 30) {
  const rows = await sql()`
    select u.id, u.display_name as name, m.role,
      count(t.id) filter (where t.archived_at is null and c.kind <> 'done')::int as open,
      count(t.id) filter (where t.archived_at is null and c.kind = 'active' and c.name ilike '%progress%')::int as in_progress,
      count(t.id) filter (where t.archived_at is null and c.kind <> 'done' and t.due_date < current_date)::int as overdue,
      count(t.id) filter (where c.kind = 'done' and t.completed_at > now() - make_interval(days => ${sinceDays}))::int as completed
    from workspace_members m join users u on u.id = m.user_id
    left join task_assignees ta on ta.user_id = u.id
    left join tasks t on t.id = ta.task_id and t.workspace_id = ${workspaceId}
    left join board_columns c on c.id = t.column_id
    where m.workspace_id = ${workspaceId} and u.is_active group by u.id, u.display_name, m.role order by u.display_name`;
  const [w] = await sql()`
    select count(*) filter (where not exists (select 1 from task_assignees x where x.task_id = t.id))::int as unassigned,
           count(*) filter (where t.due_date is not null and t.due_date < current_date + 2 and c.kind <> 'done' and t.created_at > now() - interval '1 day' and t.due_date >= current_date)::int as tight
    from tasks t join board_columns c on c.id = t.column_id where t.workspace_id = ${workspaceId} and t.archived_at is null and c.kind <> 'done'`;
  return { people: rows.map((r) => ({ id: r.id, name: r.name, role: r.role, open: r.open, inProgress: r.in_progress, overdue: r.overdue, completed: r.completed })), unassigned: w.unassigned as number, sinceDays };
}

// ── Saved views ─────────────────────────────────────────────────────────────
export async function listViews(workspaceId: string, userId: string) {
  return (await sql()`select id, name, query, shared, user_id = ${userId} as mine from saved_views where workspace_id = ${workspaceId} and (user_id = ${userId} or shared) order by name`).map((v) => ({ id: v.id as string, name: v.name as string, query: v.query as string, shared: v.shared as boolean, mine: v.mine as boolean }));
}
export async function saveView(a: Actor, name: string, query: string, shared: boolean) {
  if (!name.trim()) throw badRequest("Name the view.");
  await sql()`insert into saved_views (workspace_id, user_id, name, query, shared) values (${a.workspaceId}, ${a.id}, ${name.trim()}, ${query}, ${shared})`;
}
export async function deleteView(a: Actor, id: string) {
  const r = await sql()`delete from saved_views where id = ${id} and workspace_id = ${a.workspaceId} and (user_id = ${a.id} or ${can(a.role, "board.configure")}) returning id`;
  if (!r.length) throw notFound();
}
export { AppError };
