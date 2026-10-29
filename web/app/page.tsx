import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { listWorkspaces } from "@/lib/server/workspaces";

export default async function Home() {
  const u = await currentUser();
  if (!u) redirect("/login");
  if (u.mustChangePassword) redirect("/account/password");
  const ws = await listWorkspaces(u.id);
  redirect(ws[0] ? `/w/${ws[0].slug}` : "/workspaces/new");
}
