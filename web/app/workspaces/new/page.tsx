import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { AuthCard } from "@/components/auth-card";
import { NewWorkspaceForm } from "./form";
export const metadata = { title: "New workspace" };
export default async function Page() {
  const u = await currentUser();
  if (!u) redirect("/login");
  return <AuthCard title="Create a workspace" subtitle="A workspace holds your team's datasets, tasks and models."><NewWorkspaceForm /></AuthCard>;
}
