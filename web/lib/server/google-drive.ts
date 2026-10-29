import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { sql } from "../db";
import { badRequest, forbidden, notFound } from "../errors";
import { can, type Role } from "../authz";
import { datasetFor, type Actor } from "./datasets";
import { log } from "./activity";

// Encryption secret derived deterministically from APP_SECRET
const encKey = () => createHash("sha256").update(process.env.APP_SECRET ?? "dev-secret-wastevision-key-32b!").digest();

export function encryptSecret(plainText: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  let enc = cipher.update(plainText, "utf8", "hex");
  enc += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${enc}`;
}

export function decryptSecret(cipherText: string): string {
  const parts = cipherText.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format");
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", encKey(), iv);
  decipher.setAuthTag(tag);
  let dec = decipher.update(dataHex, "hex", "utf8");
  dec += decipher.final("utf8");
  return dec;
}

export function getGoogleOAuthEnv() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/auth/google/callback";
  return { clientId, clientSecret, redirectUri };
}

export function generateGoogleAuthUrl(workspaceSlug: string, userId: string): string {
  const { clientId, redirectUri } = getGoogleOAuthEnv();
  if (!clientId) {
    throw badRequest("Google Drive OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local.");
  }
  const statePayload = JSON.stringify({ slug: workspaceSlug, uid: userId, time: Date.now() });
  const state = Buffer.from(statePayload).toString("base64url");
  const scopes = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/userinfo.email",
  ].join(" ");

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeGoogleCode(code: string) {
  const { clientId, clientSecret, redirectUri } = getGoogleOAuthEnv();
  if (!clientId || !clientSecret) {
    throw badRequest("Google Client ID or Secret missing");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw badRequest(`Google OAuth failed: ${errText}`);
  }
  const data = await res.json();
  let email = "";
  if (data.access_token) {
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${data.access_token}` },
    }).catch(() => null);
    if (userRes && userRes.ok) {
      const uinfo = await userRes.json();
      email = uinfo.email || "";
    }
  }
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string | undefined,
    expiresIn: data.expires_in as number,
    email,
  };
}

export async function getValidDriveAccessToken(workspaceId: string): Promise<string> {
  const [conn] = await sql()`
    select refresh_token_enc, access_token_enc, expires_at
    from workspace_drive_connections where workspace_id = ${workspaceId}
  `;
  if (!conn) throw badRequest("Google Drive is not connected to this workspace. Please connect Drive first.");

  const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : 0;
  // If access token is still valid for > 90 seconds, use it
  if (conn.access_token_enc && expiresAt > Date.now() + 90_000) {
    try {
      return decryptSecret(conn.access_token_enc);
    } catch {
      // If decryption fails, fall through to refresh
    }
  }

  // Refresh token flow
  const refreshToken = decryptSecret(conn.refresh_token_enc);
  const { clientId, clientSecret } = getGoogleOAuthEnv();
  if (!clientId || !clientSecret) throw badRequest("Google Drive OAuth credentials missing");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw badRequest(`Failed to refresh Google Drive token: ${errText}`);
  }
  const data = await res.json();
  const newAccessToken = data.access_token as string;
  const expiresIn = (data.expires_in as number) || 3600;
  const newExpiresAt = new Date(Date.now() + expiresIn * 1000);

  await sql()`
    update workspace_drive_connections
    set access_token_enc = ${encryptSecret(newAccessToken)}, expires_at = ${newExpiresAt}, updated_at = now()
    where workspace_id = ${workspaceId}
  `;
  return newAccessToken;
}

export async function getDriveConnection(workspaceId: string) {
  const [c] = await sql()`
    select workspace_id, google_account_email, folder_id, folder_name, labels_folder_id, exports_folder_id, created_at, updated_at
    from workspace_drive_connections where workspace_id = ${workspaceId}
  `;
  if (!c) return null;
  return {
    workspaceId: c.workspace_id as string,
    email: c.google_account_email as string | null,
    folderId: c.folder_id as string | null,
    folderName: c.folder_name as string | null,
    labelsFolderId: c.labels_folder_id as string | null,
    exportsFolderId: c.exports_folder_id as string | null,
    connectedAt: new Date(c.created_at).toISOString(),
    updatedAt: new Date(c.updated_at).toISOString(),
  };
}

export async function saveDriveConnection(
  workspaceId: string,
  userId: string,
  tokens: { accessToken: string; refreshToken?: string; expiresIn: number; email?: string }
) {
  const expiresAt = new Date(Date.now() + (tokens.expiresIn || 3600) * 1000);
  const encAccess = encryptSecret(tokens.accessToken);
  const encRefresh = tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null;

  if (encRefresh) {
    await sql()`
      insert into workspace_drive_connections (
        workspace_id, google_account_email, refresh_token_enc, access_token_enc, expires_at, connected_by
      ) values (
        ${workspaceId}, ${tokens.email ?? null}, ${encRefresh}, ${encAccess}, ${expiresAt}, ${userId}
      )
      on conflict (workspace_id) do update set
        google_account_email = coalesce(excluded.google_account_email, workspace_drive_connections.google_account_email),
        refresh_token_enc = excluded.refresh_token_enc,
        access_token_enc = excluded.access_token_enc,
        expires_at = excluded.expires_at,
        connected_by = excluded.connected_by,
        updated_at = now()
    `;
  } else {
    await sql()`
      update workspace_drive_connections
      set access_token_enc = ${encAccess}, expires_at = ${expiresAt}, updated_at = now()
      where workspace_id = ${workspaceId}
    `;
  }
}

export async function disconnectDrive(actor: Actor) {
  if (!can(actor.role, "datasets.edit")) throw forbidden();
  await sql()`delete from workspace_drive_connections where workspace_id = ${actor.workspaceId}`;
  await log(sql(), actor.workspaceId, actor.id, "drive.disconnected", "workspace", actor.workspaceId, "Disconnected Google Drive");
}

/* ──────────────────── Google Drive API Operations ──────────────────── */

export async function listDriveFolders(workspaceId: string) {
  const token = await getValidDriveAccessToken(workspaceId);
  const q = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,parents)&pageSize=100&orderBy=name`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = await res.text();
    throw badRequest(`Drive API list folders failed: ${err}`);
  }
  const data = await res.json();
  return (data.files || []) as { id: string; name: string; parents?: string[] }[];
}

export async function findOrCreateSubfolder(workspaceId: string, parentFolderId: string, folderName: string): Promise<string> {
  const token = await getValidDriveAccessToken(workspaceId);
  const q = `'${parentFolderId}' in parents and name = '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`;
  const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (searchRes.ok) {
    const data = await searchRes.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id as string;
    }
  }

  // Create folder
  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentFolderId],
    }),
  });
  if (!createRes.ok) {
    const err = await createRes.text();
    throw badRequest(`Failed to create subfolder "${folderName}" in Drive: ${err}`);
  }
  const created = await createRes.json();
  return created.id as string;
}

export async function updateDriveFoldersConfig(
  actor: Actor,
  input: { folderId: string; folderName?: string; labelsFolderId?: string; exportsFolderId?: string }
) {
  if (!can(actor.role, "datasets.edit")) throw forbidden();
  let labelsFolderId = input.labelsFolderId;
  let exportsFolderId = input.exportsFolderId;

  // If labels or exports folder IDs are not explicitly specified, create default subfolders inside source folder
  if (!labelsFolderId) {
    labelsFolderId = await findOrCreateSubfolder(actor.workspaceId, input.folderId, "labels");
  }
  if (!exportsFolderId) {
    exportsFolderId = await findOrCreateSubfolder(actor.workspaceId, input.folderId, "exports");
  }

  await sql()`
    update workspace_drive_connections
    set folder_id = ${input.folderId},
        folder_name = ${input.folderName ?? "Shared Folder"},
        labels_folder_id = ${labelsFolderId},
        exports_folder_id = ${exportsFolderId},
        updated_at = now()
    where workspace_id = ${actor.workspaceId}
  `;

  await log(
    sql(),
    actor.workspaceId,
    actor.id,
    "drive.configured",
    "workspace",
    actor.workspaceId,
    `Configured Drive folder: ${input.folderName ?? input.folderId}`
  );
  return { folderId: input.folderId, labelsFolderId, exportsFolderId };
}

export type DriveFileInfo = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  imageMediaMetadata?: { width?: number; height?: number };
  md5Checksum?: string;
};

export async function listImagesInDriveFolder(
  workspaceId: string,
  folderId: string,
  pageToken?: string,
  pageSize = 50
): Promise<{ files: DriveFileInfo[]; nextPageToken?: string }> {
  const token = await getValidDriveAccessToken(workspaceId);
  const q = `'${folderId}' in parents and (mimeType contains 'image/' or name contains '.jpg' or name contains '.jpeg' or name contains '.png' or name contains '.webp') and trashed = false`;
  const fields = "nextPageToken,files(id,name,mimeType,size,imageMediaMetadata,md5Checksum)";
  let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&pageSize=${pageSize}&orderBy=name`;
  if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = await res.text();
    throw badRequest(`Drive API list images failed: ${err}`);
  }
  const data = await res.json();
  return {
    files: (data.files || []) as DriveFileInfo[],
    nextPageToken: data.nextPageToken as string | undefined,
  };
}

export async function streamDriveFile(workspaceId: string, fileId: string) {
  const token = await getValidDriveAccessToken(workspaceId);
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw notFound("Drive file not found or inaccessible");
  }
  return res;
}

export async function writeDriveLabelFile(
  workspaceId: string,
  labelsFolderId: string,
  imageFilename: string,
  yoloContent: string
): Promise<{ labelFileId: string; status: "created" | "updated" }> {
  const token = await getValidDriveAccessToken(workspaceId);
  const baseName = imageFilename.replace(/\.[^/.]+$/, "");
  const labelFileName = `${baseName}.txt`;

  // Search if label file already exists in the labels folder
  const q = `'${labelsFolderId}' in parents and name = '${labelFileName.replace(/'/g, "\\'")}' and trashed = false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`;
  const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${token}` } });
  let existingId: string | null = null;
  if (searchRes.ok) {
    const sdata = await searchRes.json();
    if (sdata.files && sdata.files.length > 0) {
      existingId = sdata.files[0].id as string;
    }
  }

  if (existingId) {
    // Update existing file
    const patchUrl = `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media`;
    const patchRes = await fetch(patchUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/plain",
      },
      body: yoloContent,
    });
    if (!patchRes.ok) {
      const err = await patchRes.text();
      throw badRequest(`Failed to update label file in Drive: ${err}`);
    }
    return { labelFileId: existingId, status: "updated" };
  } else {
    // Create new file via multipart upload
    const boundary = "-------314159265358979323846";
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;
    const metadata = JSON.stringify({
      name: labelFileName,
      parents: [labelsFolderId],
      mimeType: "text/plain",
    });

    const multipartRequestBody =
      delimiter +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      metadata +
      delimiter +
      "Content-Type: text/plain\r\n\r\n" +
      yoloContent +
      closeDelimiter;

    const createUrl = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
    const createRes = await fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipartRequestBody,
    });
    if (!createRes.ok) {
      const err = await createRes.text();
      throw badRequest(`Failed to write label file in Drive: ${err}`);
    }
    const created = await createRes.json();
    return { labelFileId: created.id as string, status: "created" };
  }
}

/* ──────────────────── Sync Drive Images into Dataset ──────────────────── */

export async function syncDriveFolderToDataset(
  actor: Actor,
  datasetId: string,
  opts?: { pageToken?: string; pageSize?: number }
) {
  if (!can(actor.role, "datasets.edit")) throw forbidden();
  await datasetFor(actor.workspaceId, datasetId);
  const conn = await getDriveConnection(actor.workspaceId);
  if (!conn || !conn.folderId) {
    throw badRequest("No Google Drive folder configured for this workspace. Select a folder first.");
  }

  const { files, nextPageToken } = await listImagesInDriveFolder(
    actor.workspaceId,
    conn.folderId,
    opts?.pageToken,
    opts?.pageSize ?? 50
  );

  let imported = 0;
  let skipped = 0;

  for (const f of files) {
    const filename = f.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || `drive_${f.id}`;
    const sha = f.md5Checksum || createHash("sha256").update(f.id).digest("hex");
    const width = f.imageMediaMetadata?.width || 1280;
    const height = f.imageMediaMetadata?.height || 720;
    const bytes = Number(f.size) || 102400;
    const storageKey = `drive://${f.id}`;
    const thumbKey = `drive://${f.id}`;

    // Insert idempotently
    const r = await sql()`
      insert into dataset_images (
        dataset_id, filename, storage_key, thumb_key, sha256,
        width, height, bytes, status, drive_file_id, drive_sync_status, uploaded_by
      ) values (
        ${datasetId}, ${filename}, ${storageKey}, ${thumbKey}, ${sha},
        ${width}, ${height}, ${bytes}, 'unlabeled', ${f.id}, 'synced', ${actor.id}
      )
      on conflict (dataset_id, drive_file_id) do nothing
      returning id
    `;

    if (r.length > 0) {
      imported++;
    } else {
      skipped++;
    }
  }

  if (imported > 0) {
    await log(
      sql(),
      actor.workspaceId,
      actor.id,
      "dataset.drive_synced",
      "dataset",
      datasetId,
      `Synced ${imported} image${imported > 1 ? "s" : ""} from Google Drive`
    );
  }

  return {
    totalFound: files.length,
    imported,
    skipped,
    nextPageToken: nextPageToken ?? null,
    hasMore: !!nextPageToken,
  };
}

/* ──────────────────── Export YOLO Dataset to Google Drive ──────────────────── */

export async function exportDatasetToDriveFolder(
  actor: Actor,
  datasetId: string,
  versionId: string
) {
  if (!can(actor.role, "datasets.edit")) throw forbidden();
  const ds = await datasetFor(actor.workspaceId, datasetId);
  const conn = await getDriveConnection(actor.workspaceId);
  if (!conn || !conn.exportsFolderId) {
    throw badRequest("Google Drive exports folder is not configured. Connect Drive first.");
  }

  const [v] = await sql()`
    select v.* from dataset_versions v where v.id = ${versionId} and v.dataset_id = ${datasetId}
  `;
  if (!v) throw notFound("Dataset version not found");

  const classes = (v.classes as { index: number; name: string }[]).sort((a, b) => a.index - b.index);
  const classesText = classes.map((c) => c.name).join("\n") + "\n";

  // Create version folder under exports folder
  const versionName = `WasteVision_${ds.name.replace(/\s+/g, "_")}_v${v.number}`;
  const versionFolderId = await findOrCreateSubfolder(actor.workspaceId, conn.exportsFolderId, versionName);

  // Write classes.txt
  await writeTextFileToDrive(actor.workspaceId, versionFolderId, "classes.txt", classesText);

  // Generate dataset.yaml
  const yaml = [
    `# WasteVision AI YOLO Dataset Export`,
    `# Dataset: ${ds.name} (Version: v${v.number})`,
    `path: .`,
    `train: images/train`,
    `val: images/val`,
    ...(v.counts.test ? [`test: images/test`] : []),
    `names:`,
    ...classes.map((c) => `  ${c.index}: "${c.name}"`),
  ].join("\n") + "\n";
  await writeTextFileToDrive(actor.workspaceId, versionFolderId, "dataset.yaml", yaml);

  // Get version images with their labels
  const rows = await sql()`
    select vi.split, vi.class_index, vi.boxes, i.id, i.filename, i.drive_file_id, i.storage_key
    from version_images vi
    join dataset_images i on i.id = vi.image_id
    where vi.version_id = ${versionId}
    order by i.created_at, i.id
  `;

  // Create subfolders: labels/train, labels/val, labels/test
  const labelsParent = await findOrCreateSubfolder(actor.workspaceId, versionFolderId, "labels");
  const trainLabelsFolder = await findOrCreateSubfolder(actor.workspaceId, labelsParent, "train");
  const valLabelsFolder = await findOrCreateSubfolder(actor.workspaceId, labelsParent, "val");
  const testLabelsFolder = v.counts.test
    ? await findOrCreateSubfolder(actor.workspaceId, labelsParent, "test")
    : null;

  const folderBySplit: Record<string, string> = {
    train: trainLabelsFolder,
    val: valLabelsFolder,
    ...(testLabelsFolder ? { test: testLabelsFolder } : {}),
  };

  const manifestImages: { id: string; filename: string; split: string; driveFileId?: string; boxesCount: number }[] = [];

  for (const r of rows) {
    const sp = r.split as string;
    const targetFolder = folderBySplit[sp];
    if (targetFolder) {
      const boxes = (r.boxes || []) as { classIndex: number; cx: number; cy: number; w: number; h: number }[];
      const labelContent = boxes.map((b) => `${b.classIndex} ${b.cx.toFixed(6)} ${b.cy.toFixed(6)} ${b.w.toFixed(6)} ${b.h.toFixed(6)}`).join("\n") + (boxes.length ? "\n" : "");
      const baseName = (r.filename as string).replace(/\.[^/.]+$/, "");
      await writeTextFileToDrive(actor.workspaceId, targetFolder, `${baseName}.txt`, labelContent);
    }
    manifestImages.push({
      id: r.id as string,
      filename: r.filename as string,
      split: sp,
      driveFileId: (r.drive_file_id as string) || undefined,
      boxesCount: ((r.boxes as unknown[]) || []).length,
    });
  }

  // Write manifest.json
  const manifest = {
    datasetId,
    datasetName: ds.name,
    versionNumber: v.number,
    classes,
    counts: v.counts,
    exportedAt: new Date().toISOString(),
    images: manifestImages,
  };
  await writeTextFileToDrive(actor.workspaceId, versionFolderId, "manifest.json", JSON.stringify(manifest, null, 2));

  // Record export in dataset_drive_exports
  const [exp] = await sql()`
    insert into dataset_drive_exports (
      workspace_id, dataset_id, version_id, status, manifest, drive_folder_id, counts, created_by, finished_at
    ) values (
      ${actor.workspaceId}, ${datasetId}, ${versionId}, 'completed', ${sql().json(manifest)}, ${versionFolderId}, ${sql().json(v.counts)}, ${actor.id}, now()
    ) returning id
  `;

  await log(
    sql(),
    actor.workspaceId,
    actor.id,
    "dataset.exported_drive",
    "dataset",
    datasetId,
    `Exported YOLO dataset ${versionName} to Google Drive`
  );

  return {
    exportId: exp.id as string,
    versionFolderId,
    versionName,
    counts: v.counts,
    message: `Exported successfully to Drive folder "${versionName}". Ready for Colab training!`,
  };
}

async function writeTextFileToDrive(workspaceId: string, folderId: string, filename: string, content: string) {
  const token = await getValidDriveAccessToken(workspaceId);
  const boundary = "-------314159265358979323846";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  const metadata = JSON.stringify({ name: filename, parents: [folderId], mimeType: "text/plain" });

  const body =
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    metadata +
    delimiter +
    "Content-Type: text/plain\r\n\r\n" +
    content +
    closeDelimiter;

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`Error writing file ${filename} to Drive:`, err);
  }
}
