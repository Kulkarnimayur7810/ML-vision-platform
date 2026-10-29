-- 0005_google_drive.sql
-- Additive migration for Google Drive integration, image leasing, and dataset export metadata.

-- 1. Workspace Google Drive OAuth and folder configuration
create table if not exists workspace_drive_connections (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  google_account_email text,
  refresh_token_enc text not null,
  access_token_enc text,
  expires_at timestamptz,
  folder_id text,
  folder_name text,
  labels_folder_id text,
  exports_folder_id text,
  connected_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Additive columns on dataset_images for Google Drive and concurrent labelling queue
alter table dataset_images add column if not exists drive_file_id text;
alter table dataset_images add column if not exists drive_label_file_id text;
alter table dataset_images add column if not exists drive_sync_status text not null default 'synced' check (drive_sync_status in ('synced','pending_write','error'));
alter table dataset_images add column if not exists locked_by uuid references users(id);
alter table dataset_images add column if not exists locked_until timestamptz;

-- Unique constraint ensuring idempotent sync: no duplicate Drive images within the same dataset
create unique index if not exists idx_dataset_images_drive_file on dataset_images (dataset_id, drive_file_id) where drive_file_id is not null;

-- Indexes for efficient queue leasing and Drive sync status
create index if not exists idx_dataset_images_queue on dataset_images (dataset_id, status, locked_until);
create index if not exists idx_dataset_images_drive_sync on dataset_images (dataset_id, drive_sync_status);

-- 3. Resumable Drive synchronization jobs table
create table if not exists drive_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  dataset_id uuid not null references datasets(id) on delete cascade,
  folder_id text not null,
  status text not null default 'running' check (status in ('running','completed','failed','paused')),
  next_page_token text,
  total_found int not null default 0,
  total_imported int not null default 0,
  total_skipped int not null default 0,
  error text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_drive_sync_jobs_ds on drive_sync_jobs(dataset_id, created_at desc);

-- 4. Dataset export records for Google Drive & Colab
create table if not exists dataset_drive_exports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  dataset_id uuid not null references datasets(id) on delete cascade,
  version_id uuid references dataset_versions(id) on delete cascade,
  status text not null default 'running' check (status in ('running','completed','failed')),
  manifest jsonb not null default '{}',
  drive_folder_id text,
  drive_file_id text,
  counts jsonb not null default '{}',
  error text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists idx_dataset_drive_exports_ds on dataset_drive_exports(dataset_id, created_at desc);
