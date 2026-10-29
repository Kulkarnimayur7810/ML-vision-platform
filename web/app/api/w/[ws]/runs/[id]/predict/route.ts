import { wsHandler } from "@/lib/api";
import { createPrediction, MAX_PREDICT_BYTES } from "@/lib/server/training";
import { AppError, badRequest } from "@/lib/errors";
const a = (c: { user: { id: string }; role: any; workspaceId: string; slug: string }) => ({ id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug });
export const POST = wsHandler<{ ws: string; id: string }>("training.run", async (req, c, p) => {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_PREDICT_BYTES + 512 * 1024) throw new AppError(413, "too_large", "Files must be under 4 MB here (a hosting limit).");
  const form = await req.formData().catch(() => { throw badRequest("Expected a multipart form upload."); });
  const f = form.get("file");
  if (!f || typeof f === "string") throw badRequest("Attach an image or short video.");
  const conf = Number(form.get("conf") ?? 0.25), iou = Number(form.get("iou") ?? 0.7);
  return createPrediction(a(c), p.id, { name: f.name, data: Buffer.from(await f.arrayBuffer()) }, conf, iou);
});
