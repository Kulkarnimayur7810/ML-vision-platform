import { NextResponse, type NextRequest } from "next/server";
import { apiUser, handler } from "@/lib/api";
import { assertKey, storage, verifyLocal } from "@/lib/storage";
import { sql } from "@/lib/db";
import { notFound } from "@/lib/errors";

// Only used by the local storage driver. Requires a session, workspace membership AND a valid signature.
export const GET = handler<{ key: string[] }>(async (req, ctx) => {
  const user = await apiUser();
  const key = (await ctx.params).key.join("/");
  assertKey(key);
  const sp = req.nextUrl.searchParams;
  if (process.env.STORAGE_DRIVER === "s3") throw notFound();
  if (!verifyLocal(key, Number(sp.get("e")), sp.get("s") ?? "")) throw notFound();
  const ws = key.split("/")[1];
  const [m] = await sql()`select 1 from workspace_members where workspace_id::text = ${ws} and user_id = ${user.id}`;
  if (!m) throw notFound();
  const body = await storage().get(key).catch(() => null);
  if (!body) throw notFound();
  const type = key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : key.endsWith(".jpg") || key.endsWith(".jpeg") ? "image/jpeg" : key.endsWith(".zip") ? "application/zip" : key.endsWith(".pt") ? "application/octet-stream" : "application/octet-stream";
  return new NextResponse(new Uint8Array(body), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=60", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" } });
});
