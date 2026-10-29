import { wsHandler } from "@/lib/api";
import { getDriveConnection } from "@/lib/server/google-drive";

export const GET = wsHandler(null, async (_req, c) => {
  const connection = await getDriveConnection(c.workspaceId);
  return {
    connected: !!connection,
    connection,
  };
});
