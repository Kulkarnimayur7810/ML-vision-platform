import { sql, tx } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { can } from "../authz";
import { storage } from "../storage";
import { datasetFor, type Actor } from "./datasets";
import { log } from "./activity";
import { getDriveConnection, writeDriveLabelFile } from "./google-drive";

export type Box = { classIndex: number; cx: number; cy: number; w: number; h: number };
// Allow small objects (e.g. ~2cm screws, electronic components): 0.05% of image side
const MIN_SIDE = 0.0005;

/** Clamp to the image and drop degenerate boxes. Returns null when the box is unusable. */
export function clipBox(b: Box): Box | null {
  if (![b.cx, b.cy, b.w, b.h].every(Number.isFinite)) return null;
  const x1 = Math.max(0, b.cx - b.w / 2), x2 = Math.min(1, b.cx + b.w / 2), y1 = Math.max(0, b.cy - b.h / 2), y2 = Math.min(1, b.cy + b.h / 2);
  const w = x2 - x1, h = y2 - y1;
  if (w < MIN_SIDE || h < MIN_SIDE) return null;
  return { classIndex: b.classIndex, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, w, h };
}

export async function getAnnotation(a: Actor, datasetId: string, imageId: string) {
  const ds = await datasetFor(a.workspaceId, datasetId);
  const [i] = await sql()`select i.*, lu.display_name as labeler, ru.display_name as reviewer from dataset_images i
    left join users lu on lu.id = i.labeled_by left join users ru on ru.id = i.reviewed_by where i.id = ${imageId} and i.dataset_id = ${datasetId}`;
  if (!i) throw notFound("Image not found");
  const boxes = await sql()`select class_index, cx, cy, w, h from boxes where image_id = ${imageId} order by id`;
  // Compare inside SQL: JS Dates would truncate timestamps to milliseconds and skip/duplicate rows.
  const ref = sql()`(select created_at from dataset_images where id = ${imageId})`;
  const [prev] = await sql()`select id from dataset_images where dataset_id = ${datasetId} and (created_at, id) < (${ref}, ${imageId}::uuid) order by created_at desc, id desc limit 1`;
  const [next] = await sql()`select id from dataset_images where dataset_id = ${datasetId} and (created_at, id) > (${ref}, ${imageId}::uuid) order by created_at, id limit 1`;
  const [pos] = await sql()`select count(*)::int n from dataset_images where dataset_id = ${datasetId} and (created_at, id) <= (${ref}, ${imageId}::uuid)`;
  const [total] = await sql()`select count(*)::int n from dataset_images where dataset_id = ${datasetId}`;
  const classes = await sql()`select idx, name, guideline from dataset_classes where dataset_id = ${datasetId} order by idx`;

  // Use authenticated streaming route if image is stored in Google Drive; otherwise use storage driver url
  const imageUrl = i.drive_file_id
    ? `/api/w/${a.slug}/drive/image/${i.drive_file_id}`
    : await storage().url(i.storage_key, 1800);

  return {
    dataset: ds,
    image: {
      id: i.id as string,
      filename: i.filename as string,
      width: i.width as number,
      height: i.height as number,
      status: i.status as string,
      classIndex: i.class_index as number | null,
      isBackground: i.is_background as boolean,
      version: i.version as number,
      labeler: i.labeler as string | null,
      reviewer: i.reviewer as string | null,
      reviewNote: i.review_note as string | null,
      url: imageUrl,
      driveFileId: (i.drive_file_id as string) ?? null,
      driveSyncStatus: (i.drive_sync_status as string) ?? "synced",
    },
    boxes: boxes.map((b) => ({ classIndex: b.class_index as number, cx: b.cx as number, cy: b.cy as number, w: b.w as number, h: b.h as number })),
    classes: classes.map((c) => ({ index: c.idx as number, name: c.name as string, guideline: c.guideline as string })),
    prevId: (prev?.id as string) ?? null,
    nextId: (next?.id as string) ?? null,
    position: pos.n as number,
    total: total.n as number,
  };
}

export type SaveInput = { version: number; boxes?: Box[]; classIndex?: number | null; isBackground?: boolean };

export async function saveAnnotation(a: Actor, datasetId: string, imageId: string, input: SaveInput) {
  if (!can(a.role, "annotate")) throw forbidden();
  const ds = await datasetFor(a.workspaceId, datasetId);
  const result = await tx(async (t) => {
    const [img] = await t`select * from dataset_images where id = ${imageId} and dataset_id = ${datasetId} for update`;
    if (!img) throw notFound("Image not found");
    if (img.version !== input.version) throw conflict("Someone else changed this image's labels. Reload to see their version.", { currentVersion: img.version });
    const classes = new Set((await t`select idx from dataset_classes where dataset_id = ${datasetId}`).map((c) => c.idx as number));
    let status: string;
    let clean: Box[] = [];
    if (ds.taskType === "classify") {
      if (input.classIndex != null && !classes.has(input.classIndex)) throw badRequest("Unknown class.");
      status = input.classIndex == null ? "unlabeled" : "labeled";
      await t`delete from boxes where image_id = ${imageId}`;
      await t`update dataset_images set class_index = ${input.classIndex ?? null}, is_background = false, status = ${status}, labeled_by = ${a.id}, labeled_at = now(), reviewed_by = null, review_note = null, version = version + 1 where id = ${imageId}`;
    } else {
      for (const b of input.boxes ?? []) {
        if (!classes.has(b.classIndex)) throw badRequest("A box uses a class that doesn't exist.");
        const c = clipBox(b);
        if (!c) throw badRequest("A box is empty or outside the image. Redraw it.");
        clean.push(c);
      }
      if (clean.length > 500) throw badRequest("Too many boxes on one image (max 500).");
      const bg = !!input.isBackground && clean.length === 0;
      if (input.isBackground && clean.length) throw badRequest("An image can't be both 'no objects' and have boxes.");
      status = clean.length || bg ? "labeled" : "unlabeled";
      await t`delete from boxes where image_id = ${imageId}`;
      for (const c of clean) await t`insert into boxes (image_id, class_index, cx, cy, w, h) values (${imageId}, ${c.classIndex}, ${c.cx}, ${c.cy}, ${c.w}, ${c.h})`;
      await t`update dataset_images set is_background = ${bg}, class_index = null, status = ${status}, labeled_by = ${a.id}, labeled_at = now(), reviewed_by = null, review_note = null, version = version + 1 where id = ${imageId}`;
    }
    return {
      version: (img.version as number) + 1,
      status,
      driveFileId: img.drive_file_id as string | null,
      filename: img.filename as string,
      cleanBoxes: clean,
    };
  });

  // If this image is from Google Drive, write or update the corresponding YOLO .txt label file on Drive
  let driveSyncStatus = "synced";
  if (result.driveFileId) {
    try {
      const conn = await getDriveConnection(a.workspaceId);
      if (conn && conn.labelsFolderId) {
        const yoloContent = result.cleanBoxes
          .map((b) => `${b.classIndex} ${b.cx.toFixed(6)} ${b.cy.toFixed(6)} ${b.w.toFixed(6)} ${b.h.toFixed(6)}`)
          .join("\n") + (result.cleanBoxes.length ? "\n" : "");
        const driveRes = await writeDriveLabelFile(a.workspaceId, conn.labelsFolderId, result.filename, yoloContent);
        await sql()`
          update dataset_images set drive_sync_status = 'synced', drive_label_file_id = ${driveRes.labelFileId}
          where id = ${imageId}
        `;
      }
    } catch (driveErr) {
      console.error("Drive label write warning:", driveErr);
      driveSyncStatus = "pending_write";
      await sql()`update dataset_images set drive_sync_status = 'pending_write' where id = ${imageId}`;
    }
  }

  return { version: result.version, status: result.status, driveSyncStatus };
}

/** Approve or send back. Reviewers must have the review permission; only the owner may approve their own labels. */
export async function reviewImage(a: Actor, datasetId: string, imageId: string, input: { decision: "approve" | "needs_fixes"; note?: string }) {
  if (!can(a.role, "review")) throw forbidden();
  await datasetFor(a.workspaceId, datasetId);
  await tx(async (t) => {
    const [img] = await t`select status, labeled_by, filename from dataset_images where id = ${imageId} and dataset_id = ${datasetId} for update`;
    if (!img) throw notFound("Image not found");
    if (img.status === "unlabeled") throw badRequest("This image has no labels to review yet.");
    if (img.labeled_by === a.id && a.role !== "owner") throw forbidden("Ask another reviewer to approve labels you made yourself.");
    if (input.decision === "needs_fixes" && !input.note?.trim()) throw badRequest("Say what needs fixing so the annotator knows.");
    await t`update dataset_images set status = ${input.decision === "approve" ? "approved" : "needs_fixes"}, reviewed_by = ${a.id}, review_note = ${input.decision === "approve" ? null : input.note!.trim()} where id = ${imageId}`;
    await log(t, a.workspaceId, a.id, "annotation.reviewed", "dataset", datasetId, `${input.decision === "approve" ? "Approved" : "Sent back"} ${img.filename}`);
  });
}

/**
 * First image the user should work on next: needs_fixes, then unlabeled (or labeled when reviewing).
 * Supports atomic leasing to prevent two annotators from being assigned the same image concurrently.
 */
export async function nextToLabel(datasetId: string, mode: "label" | "review", userId?: string) {
  if (mode === "review") {
    const [r] = await sql()`select id from dataset_images where dataset_id = ${datasetId} and status = 'labeled' order by created_at, id limit 1`;
    return (r?.id as string) ?? null;
  }

  // Label mode with 15-minute lease protection
  if (userId) {
    return tx(async (t) => {
      const [img] = await t`
        select id from dataset_images
        where dataset_id = ${datasetId}
          and status in ('needs_fixes', 'unlabeled')
          and (locked_until is null or locked_until < now() or locked_by = ${userId}::uuid)
        order by (status = 'needs_fixes') desc, created_at, id
        limit 1
        for update skip locked
      `;
      if (!img) return null;
      await t`
        update dataset_images
        set locked_by = ${userId}::uuid, locked_until = now() + interval '15 minutes'
        where id = ${img.id}
      `;
      return img.id as string;
    });
  }

  const [r] = await sql()`
    select id from dataset_images
    where dataset_id = ${datasetId} and status in ('needs_fixes','unlabeled')
    order by (status = 'needs_fixes') desc, created_at, id limit 1
  `;
  return (r?.id as string) ?? null;
}
