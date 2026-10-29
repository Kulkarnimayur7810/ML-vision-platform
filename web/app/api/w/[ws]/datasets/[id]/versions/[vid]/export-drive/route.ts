import { wsHandler } from "@/lib/api";
import { exportDatasetToDriveFolder } from "@/lib/server/google-drive";

export const POST = wsHandler<{ ws: string; id: string; vid: string }>(
  "datasets.edit",
  async (_req, c, params) => {
    const actor = { id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug };
    const result = await exportDatasetToDriveFolder(actor, params.id, params.vid);
    return result;
  }
);
