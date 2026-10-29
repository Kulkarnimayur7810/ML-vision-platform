import { parse, wsHandler } from "@/lib/api";
import { z } from "zod";
import { syncDriveFolderToDataset } from "@/lib/server/google-drive";

const schema = z.object({
  datasetId: z.string().uuid("Valid dataset ID is required"),
  pageToken: z.string().optional(),
  pageSize: z.number().int().min(1).max(100).default(50),
});

export const POST = wsHandler("datasets.edit", async (req, c) => {
  const body = await parse(req, schema);
  const result = await syncDriveFolderToDataset(
    { id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug },
    body.datasetId,
    { pageToken: body.pageToken, pageSize: body.pageSize }
  );
  return result;
});
