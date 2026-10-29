import { parse, wsHandler } from "@/lib/api";
import { z } from "zod";
import { updateDriveFoldersConfig } from "@/lib/server/google-drive";

const schema = z.object({
  folderId: z.string().min(1, "Folder ID is required"),
  folderName: z.string().optional(),
  labelsFolderId: z.string().optional(),
  exportsFolderId: z.string().optional(),
});

export const POST = wsHandler("datasets.edit", async (req, c) => {
  const body = await parse(req, schema);
  const result = await updateDriveFoldersConfig(
    { id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug },
    body
  );
  return result;
});
