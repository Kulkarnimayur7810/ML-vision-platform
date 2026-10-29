import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { addMember, closeSql, makeWorkspace, resetDb } from "../helpers/db";
import * as k from "@/lib/server/kanban";
import { matches } from "@/lib/kanban-types";

beforeAll(resetDb);
afterAll(closeSql);

async function setup() {
  const w = await makeWorkspace();
  const board = await k.getBoard(w.id);
  const col = (name: string) => board.columns.find((c) => c.name === name)!.id;
  return { w, owner: w.actor(), col };
}

describe("tasks & assignment", () => {
  it("creates numbered tasks with real assignees and notifies them", async () => {
    const { w, owner, col } = await setup();
    const bob = await addMember(w.id, "ml_engineer");
    const t1 = await k.createTask(owner, { title: "Collect images", columnId: col("To Do"), assigneeIds: [bob.id], priority: "high" });
    const t2 = await k.createTask(owner, { title: "Label images" });
    expect([t1.number, t2.number]).toEqual([1, 2]);
    expect(t1.assignees[0].id).toBe(bob.id);
    const { sql } = await import("@/lib/db");
    expect((await sql()`select * from notifications where user_id = ${bob.id}`).length).toBe(1);
  });
  it("refuses to assign a user who is not in the workspace", async () => {
    const { owner } = await setup();
    const other = await makeWorkspace();
    await expect(k.createTask(owner, { title: "x", assigneeIds: [other.owner.id] })).rejects.toMatchObject({ message: /members of this workspace/ });
  });
  it("supports multiple assignees and changing them", async () => {
    const { w, owner } = await setup();
    const a = await addMember(w.id, "member"), b = await addMember(w.id, "annotator");
    let t = await k.createTask(owner, { title: "Pair task", assigneeIds: [a.id, b.id] });
    expect(t.assignees).toHaveLength(2);
    t = await k.updateTask(owner, t.id, { version: t.version, assigneeIds: [b.id] });
    expect(t.assignees.map((x) => x.id)).toEqual([b.id]);
  });
  it("uses optimistic concurrency", async () => {
    const { owner } = await setup();
    const t = await k.createTask(owner, { title: "Race" });
    await k.updateTask(owner, t.id, { version: t.version, title: "Race 2" });
    await expect(k.updateTask(owner, t.id, { version: t.version, title: "Race 3" })).rejects.toMatchObject({ code: "conflict" });
  });
  it("lets members edit only their own or assigned tasks", async () => {
    const { w, owner } = await setup();
    const m = await addMember(w.id, "member");
    const mine = await k.createTask(w.actor(m.id, "member"), { title: "Mine" });
    const theirs = await k.createTask(owner, { title: "Theirs" });
    await k.updateTask(w.actor(m.id, "member"), mine.id, { version: mine.version, title: "Mine!" });
    await expect(k.updateTask(w.actor(m.id, "member"), theirs.id, { version: theirs.version, title: "hack" })).rejects.toMatchObject({ code: "forbidden" });
    const assigned = await k.updateTask(owner, theirs.id, { version: theirs.version, assigneeIds: [m.id] });
    await k.updateTask(w.actor(m.id, "member"), theirs.id, { version: assigned.version, title: "Now allowed" });
  });
  it("archives instead of deleting, and restores", async () => {
    const { owner } = await setup();
    const t = await k.createTask(owner, { title: "Old" });
    await k.archiveTask(owner, t.id, true);
    expect((await k.getBoard(owner.workspaceId)).tasks).toHaveLength(0);
    expect((await k.getBoard(owner.workspaceId, true)).tasks).toHaveLength(1);
    await k.archiveTask(owner, t.id, false);
    expect((await k.getBoard(owner.workspaceId)).tasks).toHaveLength(1);
  });
});

describe("moving & ordering", () => {
  it("persists column and order, inserts between neighbours", async () => {
    const { owner, col } = await setup();
    const a = await k.createTask(owner, { title: "A", columnId: col("To Do") });
    const b = await k.createTask(owner, { title: "B", columnId: col("To Do") });
    const c = await k.createTask(owner, { title: "C", columnId: col("To Do") });
    await k.moveTask(owner, c.id, { version: c.version, columnId: col("To Do"), beforeId: a.id });
    const order = (await k.getBoard(owner.workspaceId)).tasks.filter((t) => t.columnId === col("To Do")).map((t) => t.title);
    expect(order).toEqual(["C", "A", "B"]);
    const moved = await k.moveTask(owner, a.id, { version: (await k.getTask(owner.workspaceId, a.number)).version, columnId: col("In Progress") });
    expect(moved.columnId).toBe(col("In Progress"));
    expect(b.title).toBe("B");
  });
  it("survives many insertions at the same spot (rebalancing)", async () => {
    const { owner, col } = await setup();
    const first = await k.createTask(owner, { title: "first", columnId: col("To Do") });
    for (let i = 0; i < 60; i++) {
      const t = await k.createTask(owner, { title: "n" + i, columnId: col("To Do") });
      await k.moveTask(owner, t.id, { version: t.version, columnId: col("To Do"), beforeId: first.id });
    }
    const tasks = (await k.getBoard(owner.workspaceId)).tasks;
    const pos = tasks.map((t) => t.position);
    expect(new Set(pos).size).toBe(pos.length);
    expect(tasks.at(-1)!.title).toBe("first");
  });
  it("sets completed_at only in done columns", async () => {
    const { owner, col } = await setup();
    let t = await k.createTask(owner, { title: "Finish" });
    t = await k.moveTask(owner, t.id, { version: t.version, columnId: col("Done") });
    expect(t.done && t.completedAt).toBeTruthy();
    t = await k.moveTask(owner, t.id, { version: t.version, columnId: col("To Do") });
    expect(t.completedAt).toBeNull();
  });
});

describe("dependencies & subtasks", () => {
  it("blocks completion until blockers are done and rejects cycles", async () => {
    const { owner, col } = await setup();
    const a = await k.createTask(owner, { title: "A" }), b = await k.createTask(owner, { title: "B" }), c = await k.createTask(owner, { title: "C" });
    await k.addDependency(owner, b.id, a.id); // B blocked by A
    await k.addDependency(owner, c.id, b.id); // C blocked by B
    await expect(k.addDependency(owner, a.id, c.id)).rejects.toMatchObject({ message: /circular/ });
    await expect(k.addDependency(owner, a.id, a.id)).rejects.toBeTruthy();
    const bb = await k.getTask(owner.workspaceId, b.number);
    expect(bb.blockedBy[0].number).toBe(a.number);
    await expect(k.moveTask(owner, b.id, { version: bb.version, columnId: col("Done") })).rejects.toMatchObject({ message: /Blocked by/ });
    const aa = await k.getTask(owner.workspaceId, a.number);
    await k.moveTask(owner, a.id, { version: aa.version, columnId: col("Done") });
    const b2 = await k.getTask(owner.workspaceId, b.number);
    await k.moveTask(owner, b.id, { version: b2.version, columnId: col("Done") });
  });
  it("tracks subtask progress and forbids nesting", async () => {
    const { owner, col } = await setup();
    const p = await k.createTask(owner, { title: "Parent" });
    const s1 = await k.createTask(owner, { title: "S1", parentId: p.id }), s2 = await k.createTask(owner, { title: "S2", parentId: p.id });
    await k.moveTask(owner, s1.id, { version: s1.version, columnId: col("Done") });
    const pp = await k.getTask(owner.workspaceId, p.number);
    expect([pp.subtaskDone, pp.subtaskTotal]).toEqual([1, 2]);
    await expect(k.createTask(owner, { title: "deep", parentId: s2.id })).rejects.toBeTruthy();
  });
});

describe("isolation", () => {
  it("never touches another workspace's tasks by id", async () => {
    const a = await setup(), b = await setup();
    const t = await k.createTask(a.owner, { title: "secret" });
    await expect(k.updateTask(b.owner, t.id, { version: 1, title: "pwn" })).rejects.toMatchObject({ code: "not_found" });
    await expect(k.addComment(b.owner, t.id, "hi")).rejects.toMatchObject({ code: "not_found" });
    await expect(k.archiveTask(b.owner, t.id, true)).rejects.toMatchObject({ code: "not_found" });
    expect((await k.getBoard(b.w.id)).tasks).toHaveLength(0);
    await expect(k.getTask(b.w.id, t.number)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("filters, columns, workload", () => {
  it("filters by assignee, unassigned, overdue and text", async () => {
    const { w, owner } = await setup();
    const bob = await addMember(w.id, "member");
    await k.createTask(owner, { title: "Overdue thing", assigneeIds: [bob.id], dueDate: "2020-01-01" });
    await k.createTask(owner, { title: "Nobody" });
    const { tasks } = await k.getBoard(w.id);
    expect(tasks.filter((t) => matches(t, { assignee: [bob.id] }, owner.id))).toHaveLength(1);
    expect(tasks.filter((t) => matches(t, { unassigned: true }, owner.id))).toHaveLength(1);
    expect(tasks.filter((t) => matches(t, { overdue: true }, owner.id)).map((t) => t.title)).toEqual(["Overdue thing"]);
    expect(tasks.filter((t) => matches(t, { q: "#2" }, owner.id)).map((t) => t.title)).toEqual(["Nobody"]);
  });
  it("only admins configure columns; non-empty columns can't be removed", async () => {
    const { w, owner, col } = await setup();
    const m = await addMember(w.id, "ml_engineer");
    await expect(k.createColumn(w.actor(m.id, "ml_engineer"), "X", "active")).rejects.toMatchObject({ code: "forbidden" });
    await k.createColumn(owner, "QA", "active");
    await k.createTask(owner, { title: "t", columnId: col("To Do") });
    await expect(k.archiveColumn(owner, col("To Do"))).rejects.toMatchObject({ message: /Move or archive/ });
  });
  it("reports workload per member", async () => {
    const { w, owner, col } = await setup();
    const bob = await addMember(w.id, "member");
    await k.createTask(owner, { title: "o", assigneeIds: [bob.id], dueDate: "2020-01-01", columnId: col("In Progress") });
    const done = await k.createTask(owner, { title: "d", assigneeIds: [bob.id], columnId: col("Done") });
    expect(done.done).toBe(true);
    await k.createTask(owner, { title: "unowned" });
    const r = await k.workload(w.id);
    const p = r.people.find((x) => x.id === bob.id)!;
    expect([p.open, p.inProgress, p.overdue, p.completed]).toEqual([1, 1, 1, 1]);
    expect(r.unassigned).toBe(1);
  });
});
