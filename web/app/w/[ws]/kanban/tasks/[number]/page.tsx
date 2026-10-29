import { redirect } from "next/navigation";
// Shareable task URL: opens the board with the task drawer.
export default async function Page({ params }: { params: Promise<{ ws: string; number: string }> }) {
  const { ws, number } = await params;
  redirect(`/w/${ws}/kanban?task=${encodeURIComponent(number)}`);
}
