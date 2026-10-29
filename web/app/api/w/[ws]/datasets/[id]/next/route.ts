import { wsHandler } from "@/lib/api";
import { datasetFor } from "@/lib/server/datasets";
import { nextToLabel } from "@/lib/server/annotations";
export const GET = wsHandler<{ ws: string; id: string }>("workspace.view", async (req, c, p) => {
  await datasetFor(c.workspaceId, p.id);
  const mode = new URL(req.url).searchParams.get("mode") === "review" ? "review" : "label";
  return { imageId: await nextToLabel(p.id, mode) };
});
