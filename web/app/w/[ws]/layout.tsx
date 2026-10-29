import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { workspaceFor } from "@/lib/api";
import { listWorkspaces } from "@/lib/server/workspaces";
import { Shell } from "@/components/shell/shell";
import { AppError } from "@/lib/errors";
import { notFound } from "next/navigation";

export default async function WsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ ws: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/account/password");
  const { ws } = await params;
  let c;
  try { c = await workspaceFor(user, ws); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const all = await listWorkspaces(user.id);
  const name = all.find((w) => w.slug === c.slug)?.name ?? c.slug;
  return <Shell slug={c.slug} workspaceName={name} role={c.role} user={{ id: user.id, name: user.displayName, email: user.email }} workspaces={all.map((w) => ({ slug: w.slug, name: w.name }))}>{children}</Shell>;
}
