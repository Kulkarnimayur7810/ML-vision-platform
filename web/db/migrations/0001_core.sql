create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text not null,
  password_hash text not null,
  must_change_password boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index users_email_lower on users (lower(email));

create table user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text
);
create index user_sessions_user on user_sessions(user_id);

create table login_attempts (
  id bigserial primary key,
  email text not null,
  ip text,
  ok boolean not null,
  at timestamptz not null default now()
);
create index login_attempts_email_at on login_attempts (lower(email), at desc);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner','admin','ml_engineer','annotator','member')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user on workspace_members(user_id);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text,
  role text not null check (role in ('admin','ml_engineer','annotator','member')),
  token_hash text not null unique,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references users(id)
);

create table activity (
  id bigserial primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  actor_id uuid references users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  summary text not null,
  at timestamptz not null default now()
);
create index activity_ws_at on activity(workspace_id, at desc);

create table notifications (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null,
  title text not null,
  href text,
  read_at timestamptz,
  at timestamptz not null default now()
);
create index notifications_user on notifications(user_id, at desc);

-- Kanban
create table board_columns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  position double precision not null,
  kind text not null default 'active' check (kind in ('backlog','active','blocked','done')),
  wip_limit int,
  archived boolean not null default false
);
create index board_columns_ws on board_columns(workspace_id, position);

create table workspace_counters (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  next_task int not null default 1
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  number int not null,
  title text not null,
  description text not null default '',
  column_id uuid not null references board_columns(id),
  position double precision not null,
  priority text not null default 'medium' check (priority in ('urgent','high','medium','low')),
  workstream text,
  start_date date,
  due_date date,
  created_by uuid references users(id),
  parent_id uuid references tasks(id) on delete set null,
  related_type text,
  related_id text,
  version int not null default 1,
  archived_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, number)
);
create index tasks_board on tasks(workspace_id, column_id, position) where archived_at is null;
create index tasks_parent on tasks(parent_id);

create table task_assignees (
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  primary key (task_id, user_id)
);
create index task_assignees_user on task_assignees(user_id);

create table labels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  color text not null default 'gray',
  unique (workspace_id, name)
);
create table task_labels (
  task_id uuid not null references tasks(id) on delete cascade,
  label_id uuid not null references labels(id) on delete cascade,
  primary key (task_id, label_id)
);

create table task_dependencies (
  task_id uuid not null references tasks(id) on delete cascade,
  depends_on uuid not null references tasks(id) on delete cascade,
  primary key (task_id, depends_on),
  check (task_id <> depends_on)
);

create table task_comments (
  id bigserial primary key,
  task_id uuid not null references tasks(id) on delete cascade,
  author_id uuid references users(id),
  body text not null,
  created_at timestamptz not null default now()
);
create index task_comments_task on task_comments(task_id, created_at);

create table saved_views (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  query text not null,
  shared boolean not null default false,
  created_at timestamptz not null default now()
);
