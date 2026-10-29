"use client";
import useSWR from "swr";
import { fetcher } from "@/lib/client/api";
import { Alert, Avatar } from "@/components/ui/form";
import { ROLE_LABEL, type Role } from "@/lib/authz";

type W = { people: { id: string; name: string; role: Role; open: number; inProgress: number; overdue: number; completed: number }[]; unassigned: number; sinceDays: number };

export function Workload({ slug }: { slug: string }) {
  const { data, error } = useSWR<W>(`/api/w/${slug}/workload?days=30`, fetcher, { refreshInterval: 15000 });
  if (error) return <div className="p-4"><Alert>{(error as Error).message}</Alert></div>;
  if (!data) return <p className="p-4 text-sm text-fg-subtle">Loading…</p>;
  return (
    <div className="space-y-3 p-3 md:p-4">
      {data.unassigned > 0 && <Alert kind="warn">{data.unassigned} open task{data.unassigned > 1 ? "s have" : " has"} no owner.</Alert>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[13px]" data-testid="workload">
          <caption className="sr-only">Open and completed tasks per team member</caption>
          <thead className="text-xs text-fg-subtle"><tr><th className="py-1.5 font-medium">Member</th><th className="font-medium">Open</th><th className="font-medium">In progress</th><th className="font-medium">Overdue</th><th className="font-medium">Done (last {data.sinceDays} days)</th></tr></thead>
          <tbody className="divide-y divide-line">
            {data.people.map((p) => (
              <tr key={p.id}><td className="py-2"><span className="flex items-center gap-2"><Avatar name={p.name} size={22} /><span>{p.name}<span className="ml-1.5 text-xs text-fg-subtle">{ROLE_LABEL[p.role]}</span></span></span></td>
                <td>{p.open}</td><td>{p.inProgress}</td><td className={p.overdue ? "font-medium text-danger" : ""}>{p.overdue}</td><td>{p.completed}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-fg-subtle">Task counts show where work is sitting. They are not a measure of anyone's productivity.</p>
    </div>
  );
}
