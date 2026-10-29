import { wsHandler } from "@/lib/api";
import { datasetFor, browseImages } from "@/lib/server/datasets";
import { ingestImage, logUploadBatch, MAX_UPLOAD_BYTES, type UploadResult } from "@/lib/server/ingest";
import { AppError, badRequest } from "@/lib/errors";

export const GET = wsHandler<{ ws: string; id: string }>("workspace.view", async (req, c, p) => {
  await datasetFor(c.workspaceId, p.id);
  const sp = new URL(req.url).searchParams;
  return browseImages(p.id, { status: sp.get("status") ?? undefined, after: sp.get("after"), limit: Number(sp.get("limit")) || 48 });
});

export const POST = wsHandler<{ ws: string; id: string }>("datasets.edit", async (req, c, p) => {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES + 512 * 1024) throw new AppError(413, "too_large", "Upload at most ~4 MB per request (the host limits request size). Send fewer or smaller images at a time.");
  const a = { id: c.user.id, role: c.role, workspaceId: c.workspaceId, slug: c.slug };
  const form = await req.formData().catch(() => { throw badRequest("Expected a multipart form upload."); });
  const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
  if (!files.length) throw badRequest("No files were attached.");
  if (files.length > 10) throw badRequest("At most 10 files per request.");
  const results: UploadResult[] = [];
  for (const f of files) results.push(await ingestImage(a, p.id, f.name, Buffer.from(await f.arrayBuffer())));
  await logUploadBatch(a, p.id, results);
  return { results };
});
