create table training_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  number int not null,
  name text not null,
  dataset_id uuid not null references datasets(id),
  version_id uuid not null references dataset_versions(id),
  task_type text not null check (task_type in ('detect','classify')),
  arch text not null,
  pretrained boolean not null,
  config jsonb not null,
  job_id uuid references worker_jobs(id),
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled','interrupted')),
  started_at timestamptz,
  finished_at timestamptz,
  epochs_done int not null default 0,
  best_metrics jsonb,          -- always from the VALIDATION split during training
  device text,
  artifacts jsonb not null default '{}',   -- { best: key, last: key }
  error text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, number)
);
create index training_runs_ws on training_runs(workspace_id, created_at desc);

create table run_epochs (
  run_id uuid not null references training_runs(id) on delete cascade,
  epoch int not null,
  metrics jsonb not null,
  at timestamptz not null default now(),
  primary key (run_id, epoch)
);

create table model_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  run_id uuid not null references training_runs(id),
  name text not null,                 -- e.g. "waste-detector"
  number int not null,                -- version number within the name
  artifact_key text not null,
  size_bytes bigint not null,
  sha256 text not null,
  classes jsonb not null,
  task_type text not null,
  arch text not null,
  notes text not null default '',
  stage text not null default 'candidate' check (stage in ('candidate','selected','archived')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, name, number)
);

create table evaluations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  run_id uuid not null references training_runs(id) on delete cascade,
  split text not null check (split in ('train','val','test')),
  status text not null default 'queued',
  job_id uuid references worker_jobs(id),
  metrics jsonb,
  per_class jsonb,
  confusion jsonb,
  speed jsonb,
  n_images int,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index evaluations_run on evaluations(run_id, created_at desc);

create table predictions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  run_id uuid not null references training_runs(id),
  job_id uuid references worker_jobs(id),
  kind text not null check (kind in ('image','video')),
  input_key text not null,
  filename text not null,
  conf real not null,
  iou real not null,
  result jsonb,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
