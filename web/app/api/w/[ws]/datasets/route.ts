import { z } from "zod";
import { parse, wsHandler } from "@/lib/api";
import { createDataset, listDatasets } from "@/lib/server/datasets";
export const GET = wsHandler("workspace.view", async (_r, c) => ({ datasets: await listDatasets(c.workspaceId) }));
export const POST = wsHandler("datasets.create", async (req, c) => {
  const b = await parse(req, z.object({ name: z.string().max(80), description: z.string().max(500).optional(), taskType: z.enum(["detect", "classify"]), classes: z.array(z.string().max(40)).max(200).optional() }));
  return { id: await createDataset({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug }, b) };
});
