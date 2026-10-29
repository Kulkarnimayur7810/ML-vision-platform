import { wsHandler } from "@/lib/api";
import { archiveDataset, datasetFor, datasetStats, listClasses } from "@/lib/server/datasets";
export const GET = wsHandler<{ ws: string; id: string }>("workspace.view", async (_r, c, p) => {
  const dataset = await datasetFor(c.workspaceId, p.id);
  const [stats, classes] = await Promise.all([datasetStats(p.id), listClasses(p.id)]);
  return { dataset, stats, classes };
});
export const DELETE = wsHandler<{ ws: string; id: string }>("workspace.view", async (_r, c, p) => archiveDataset({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, p.id));
