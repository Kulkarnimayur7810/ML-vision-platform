# Google Drive + Supabase + Next.js + Google Colab Architecture & Setup Guide

This guide explains how **WasteVision AI** integrates Google Drive, Supabase, Next.js, and Google Colab to enable collaborative multi-user image labelling and model training with **₹0 monthly cloud cost**.

---

## 1. System Architecture & Data Flow

```
┌────────────────────────┐      ┌─────────────────────────┐      ┌────────────────────────┐
│      Google Drive      │      │        Supabase         │      │      Google Colab      │
│ (Original Images,      │◄────►│  (PostgreSQL Database:  │      │   (Free T4 GPU / ₹0:   │
│  YOLO .txt Labels,     │      │   Metadata, Annotations,│      │   Ultralytics YOLOv8   │
│  Exported Datasets)    │      │   Classes, User Roles)  │      │   Training Pipeline)   │
└───────────▲────────────┘      └────────────▲────────────┘      └───────────▲────────────┘
            │                                │                               │
            │  Private streaming             │ Metadata queries              │ Reads dataset.yaml
            │  & label file sync             │ & transactions                │ & weights
            ▼                                ▼                               │
┌─────────────────────────────────────────────────────────┐                  │
│                   Next.js Web Server                    │──────────────────┘
│  (Session Auth, Bounding-Box Drawer, Drive OAuth & API) │
└─────────────────────────────────────────────────────────┘
```

### Key Principles:
1. **Google Drive**: Permanent home for large image files and YOLO `.txt` labels. Original source images are never moved, overwritten, or deleted by labelling.
2. **Supabase PostgreSQL**: Fast metadata store for image IDs, normalized bounding box coordinates (`0..1`), class definitions, user assignments, review statuses, and activity history. Images are **never** stored as raw binaries in Supabase.
3. **Next.js Server**: Authenticated proxy that streams private Google Drive images to browser canvases and syncs YOLO annotations back to Drive.
4. **Google Colab**: Provides free NVIDIA T4 GPU compute to mount Google Drive and train YOLOv8/YOLO11 models without paying cloud compute fees.

---

## 2. Google Cloud Console Setup (Step-by-Step)

Follow these steps in the Google Cloud Console to enable Google Drive API access:

### Step 2.1: Create a Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project dropdown at the top and select **New Project**.
3. Name your project (e.g., `WasteVision-AI`) and click **Create**.

### Step 2.2: Enable Google Drive API
1. In the left navigation menu, go to **APIs & Services** → **Library**.
2. Search for **Google Drive API**.
3. Click **Google Drive API** and click **Enable**.

### Step 2.3: Configure OAuth Consent Screen
1. Go to **APIs & Services** → **OAuth consent screen**.
2. Select **External** (or **Internal** if using Google Workspace organization) and click **Create**.
3. Fill in the required fields:
   - **App name**: `WasteVision AI`
   - **User support email**: Your Google email
   - **Developer contact information**: Your email
4. Click **Save and Continue**.
5. Under **Scopes**, click **Add or Remove Scopes** and add:
   - `https://www.googleapis.com/auth/drive.readonly`
   - `https://www.googleapis.com/auth/drive.file`
   - `https://www.googleapis.com/auth/userinfo.email`
6. Click **Update** and **Save and Continue**.
7. Under **Test users**, add your Google email address (and any team members' Google emails if your app status is in Testing).
8. Click **Save and Continue**.

### Step 2.4: Create OAuth 2.0 Credentials
1. Go to **APIs & Services** → **Credentials**.
2. Click **Create Credentials** → **OAuth client ID**.
3. Under **Application type**, select **Web application**.
4. Set **Name** to `WasteVision Web Client`.
5. Under **Authorized redirect URIs**, add both:
   - **For Local Development**:
     ```
     http://localhost:3000/api/auth/google/callback
     ```
   - **For Production (e.g. Vercel)**:
     ```
     https://your-production-domain.vercel.app/api/auth/google/callback
     ```
6. Click **Create**.
7. Copy your **Client ID** and **Client Secret**.

---

## 3. Environment Variables Configuration

In `wastevision-ai/web/.env.local`, configure the following server-side environment variables:

```ini
# PostgreSQL connection string from Supabase (Project Settings → Database → Connection Pooling / port 6543)
DATABASE_URL=postgresql://postgres.yourproject:yourpassword@aws-0-region.pooler.supabase.com:6543/postgres

# Secret used to encrypt Drive OAuth refresh tokens and sign session cookies
# Generate with: openssl rand -hex 32
APP_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# Google OAuth Credentials (obtained from Google Cloud Console in Step 2.4)
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
```

> [!IMPORTANT]
> **Keeping Secrets Private**:
> - Never prefix these variables with `NEXT_PUBLIC_`.
> - Keep `.env.local` git-ignored.
> - On Vercel, set these under **Project → Settings → Environment Variables** and check the **Sensitive** option.

---

## 4. Database Migration

Run the additive database migration to add Google Drive support, concurrent image leasing, and export tracking to Supabase:

```bash
cd wastevision-ai/web
npm run migrate
```

This applies `0005_google_drive.sql`, creating:
- `workspace_drive_connections`: Encrypted token storage & folder mapping.
- Additive columns on `dataset_images`: `drive_file_id`, `drive_label_file_id`, `drive_sync_status`, `locked_by`, `locked_until`.
- Unique constraint `(dataset_id, drive_file_id)` ensuring idempotent syncs without duplicates.
- Automatic RLS lockdown via `9999_lockdown.sql`.

---

## 5. Local Installation & Run Commands

```bash
# 1. Install dependencies
cd wastevision-ai/web
npm install

# 2. Run migrations
npm run migrate

# 3. Create initial workspace owner account (if not already done)
npm run create-owner admin@wastevision.ai "Admin User" "YourPassword123!"

# 4. Start Next.js development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 6. End-to-End Workflow & Verification

### Step 6.1: Connect Google Drive
1. Sign in as Workspace Owner or Admin.
2. Navigate to **Datasets** and click on your target dataset (or create one: e.g. `waste-detector`).
3. Click the **Google Drive** tab.
4. Click **Connect Google Account** and approve the OAuth consent screen.
5. Once connected, your Google email appears with a green badge.

### Step 6.2: Configure Source and Label Folders
1. Under **Source folder (Original Images)**, choose your shared Google Drive folder from the dropdown (or paste the folder ID).
2. Click **Save Folder**.
3. WasteVision automatically links or creates:
   - Source Images Folder
   - `labels/` subfolder (for YOLO `.txt` files)
   - `exports/` subfolder (for Colab-ready datasets)

### Step 6.3: Sync Sample Images (Test with 5 Images)
1. In your Drive source folder, upload 5 sample waste photos (e.g. plastic bottle, metal can, screw, paper cup, circuit board).
2. In the **Google Drive** tab in WasteVision AI, click **Sync Images from Drive**.
3. The sync job imports metadata for the 5 photos. Re-clicking sync is idempotent and skips already-imported images.

### Step 6.4: Annotate Images
1. Click **Label images** to enter the repaired annotation tool.
2. Select a class (e.g. `plastic`, `metal`, `paper`, `screw`, `e_waste`) or press `1`–`5`.
3. Click and drag to draw a bounding box around the object:
   - Box appears immediately with high-contrast colored outline.
   - Resize handles appear on selection.
   - Move or delete with `Del` / `Backspace`.
   - Small objects (~2 cm) are fully supported.
   - Zoom in/out with mouse wheel or `+`/`-`, pan with `Space`+drag.
4. Click **Save** or press `Ctrl+S` (or press `D` / `Save & next`):
   - Box coordinates are saved to Supabase in normalized YOLO format (`cx cy w h`).
   - A matching `.txt` label file is automatically written to Google Drive in the `labels/` folder.
   - Cloud icon displays **Drive: Saved**.
5. Refresh the page: reopen the same image and verify the rectangle is intact.

### Step 6.5: Export YOLO Dataset & Train in Google Colab
1. Review and approve the images in the **Review** screen.
2. Under the **Versions** tab, create a dataset version (e.g. `v1`).
3. Click **Export YOLO to Drive**.
4. The system materializes:
   - `dataset.yaml`
   - `classes.txt`
   - `labels/train/`, `labels/val/`, `labels/test/`
   - `manifest.json`
5. Open `docs/GOOGLE_COLAB_TRAINING.ipynb` in [Google Colab](https://colab.research.google.com/).
6. Run the cells to mount Google Drive, train YOLOv8 on free GPU, and generate confusion matrices and metrics at ₹0 cost!

---

## 7. Troubleshooting & FAQ

| Problem | Root Cause | Solution |
|---|---|---|
| `Google OAuth failed: redirect_uri_mismatch` | Redirect URI in Google Cloud Console doesn't match `GOOGLE_REDIRECT_URI`. | In Google Cloud Console → Credentials, ensure `http://localhost:3000/api/auth/google/callback` is listed under Authorized redirect URIs. |
| `Google Drive token expired` | Refresh token was revoked or expired. | WasteVision auto-refreshes tokens using `refresh_token_enc`. If revoked, click Reconnect Google Account in the Google Drive tab. |
| `Drive label write warning / pending_write` | Drive API temporary rate limit or permission error on shared folder. | Ensure the connected account has Edit permission on the Drive folder. Pending writes are retried automatically on the next save. |
| `Cannot read properties of null (inverse)` | SVG matrix transformation issue when zooming. | Repaired in `annotator.tsx`: falls back smoothly to bounding client rect calculation. |
| `Turbopack Access is denied (os error 5)` on Windows | Windows non-admin symlink restriction. | Run `npm run build` which now uses `--webpack` for reliable builds across Windows, Mac, and Linux. |
