import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { workspaceFor } from "@/lib/api";
import { sql } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/authz";
export const metadata = { title: "Settings" };
export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const u = await currentUser(); if (!u) redirect("/login");
  const c = await workspaceFor(u, (await params).ws);
  const [w] = await sql()`select name, created_at from workspaces where id = ${c.workspaceId}`;
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-6">
      <h1 className="text-lg font-semibold">Settings</h1>
      <section className="space-y-1 rounded-lg border border-line p-4 text-sm"><h2 className="font-semibold">Workspace</h2>
        <p><span className="text-fg-muted">Name:</span> {w.name}</p><p><span className="text-fg-muted">Created:</span> {new Date(w.created_at).toLocaleDateString()}</p><p><span className="text-fg-muted">Your role:</span> {ROLE_LABEL[c.role]}</p>
        <p className="pt-1 text-xs text-fg-subtle">Board columns are configured from the Kanban page; members from the <Link className="underline" href={`/w/${c.slug}/team`}>Team</Link> page.</p></section>
      <section className="space-y-2 rounded-lg border border-line p-4 text-sm"><h2 className="font-semibold">Your account</h2>
        <p><span className="text-fg-muted">Signed in as</span> {u.email}</p>
        <Link href="/account/password" className="inline-block rounded-md border border-line-strong px-3 py-1.5 hover:bg-hover">Change password</Link>
        <p className="text-xs text-fg-subtle">Use the sun/moon button in the top bar to switch between light and dark themes.</p></section>
    </div>
  );
}
