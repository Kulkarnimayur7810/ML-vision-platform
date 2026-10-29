create table datasets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text not null default '',
  task_type text not null check (task_type in ('detect','classify')),
  created_by uuid references users(id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);
create table dataset_classes (
  dataset_id uuid not null references datasets(id) on delete cascade,
  idx int not null,
  name text not null,
  guideline text not null default '',
  primary key (dataset_id, idx),
  unique (dataset_id, name)
);
create table dataset_images (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references datasets(id) on delete cascade,
  filename text not null,
  storage_key text not null,
  thumb_key text not null,
  sha256 text not null,
  width int not null,
  height int not null,
  bytes int not null,
  dhash text,
  brightness real,
  blur real,
  -- annotation state: unlabeled → labeled → (review) → approved | needs_fixes
  status text not null default 'unlabeled' check (status in ('unlabeled','labeled','approved','needs_fixes')),
  class_index int,                      -- classification label
  is_background boolean not null default false, -- detection: confirmed "no objects"
  labeled_by uuid references users(id),
  labeled_at timestamptz,
  reviewed_by uuid references users(id),
  review_note text,
  version int not null default 1,
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (dataset_id, sha256)
);
create index dataset_images_browse on dataset_images(dataset_id, created_at, id);
create index dataset_images_status on dataset_images(dataset_id, status);
create table boxes (
  id bigserial primary key,
  image_id uuid not null references dataset_images(id) on delete cascade,
  class_index int not null,
  cx real not null, cy real not null, w real not null, h real not null  -- normalised 0..1 (YOLO convention)
);
create index boxes_image on boxes(image_id);

create table dataset_versions (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references datasets(id) on delete cascade,
  number int not null,
  name text not null,
  seed int not null,
  ratios jsonb not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  classes jsonb not null,
  counts jsonb not null,
  unique (dataset_id, number)
);
-- Frozen snapshot: labels as they were when the version was cut.
create table version_images (
  version_id uuid not null references dataset_versions(id) on delete cascade,
  image_id uuid not null references dataset_images(id) on delete cascade,
  split text not null check (split in ('train','val','test')),
  class_index int,
  boxes jsonb not null default '[]',
  primary key (version_id, image_id)
);
create index version_images_split on version_images(version_id, split);

create table worker_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null,
  params jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled','interrupted')),
  progress real not null default 0,
  message text,
  result jsonb,
  error text,
  cancel_requested boolean not null default false,
  created_by uuid references users(id),
  worker_id text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz
);
create index worker_jobs_queue on worker_jobs(status, created_at);
create index worker_jobs_ws on worker_jobs(workspace_id, created_at desc);
create table worker_job_logs (
  id bigserial primary key,
  job_id uuid not null references worker_jobs(id) on delete cascade,
  at timestamptz not null default now(),
  line text not null
);
create index worker_job_logs_job on worker_job_logs(job_id, id);
create table workers (
  id text primary key,
  name text not null,
  info jsonb not null default '{}',
  last_seen timestamptz not null default now()
);
