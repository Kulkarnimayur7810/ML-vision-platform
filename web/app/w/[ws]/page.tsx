import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { workspaceFor } from "@/lib/api";
import { sql } from "@/lib/db";
import Link from "next/link";
import { Overview } from "@/components/overview";
import { mlSummary } from "@/lib/server/overview";

export const metadata = { title: "Overview" };
export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const u = await currentUser();
  if (!u) redirect("/login");
  const { ws } = await params;
  const c = await workspaceFor(u, ws);
  const [counts] = await sql()`
    select count(*) filter (where c.kind <> 'done')::int open,
           count(*) filter (where c.name ilike '%progress%')::int in_progress,
           count(*) filter (where c.kind = 'blocked')::int blocked,
           count(*) filter (where c.kind = 'done')::int done,
           count(*) filter (where c.kind <> 'done' and t.due_date < current_date)::int overdue,
           count(*) filter (where c.kind <> 'done' and exists (select 1 from task_assignees a where a.task_id = t.id and a.user_id = ${u.id}))::int mine,
           count(*) filter (where c.kind <> 'done' and not exists (select 1 from task_assignees a where a.task_id = t.id))::int unassigned
    from tasks t join board_columns c on c.id = t.column_id where t.workspace_id = ${c.workspaceId} and t.archived_at is null`;
  const upcoming = await sql()`select t.number, t.title, to_char(t.due_date,'YYYY-MM-DD') due from tasks t join board_columns c on c.id = t.column_id where t.workspace_id = ${c.workspaceId} and t.archived_at is null and c.kind <> 'done' and t.due_date >= current_date order by t.due_date limit 5`;
  const ml = await mlSummary(c.workspaceId, c.slug);
  return <Overview slug={ws} name={u.displayName} ml={ml} counts={counts as any} upcoming={upcoming.map((r) => ({ number: r.number, title: r.title, due: r.due })) } />;
}
