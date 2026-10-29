import { wsHandler } from "@/lib/api";
import { listDriveFolders } from "@/lib/server/google-drive";

export const GET = wsHandler("datasets.edit", async (_req, c) => {
  const folders = await listDriveFolders(c.workspaceId);
  return { folders };
});
