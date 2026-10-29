create table docs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title text not null,
  body text not null default '',
  kind text not null default 'blank' check (kind in ('blank','meeting','collection','labeling','experiment','model_card','report')),
  version int not null default 1,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index docs_ws on docs(workspace_id, updated_at desc);

create table doc_links (
  doc_id uuid not null references docs(id) on delete cascade,
  link_type text not null check (link_type in ('task','dataset','run','model')),
  ref_id uuid not null,
  primary key (doc_id, link_type, ref_id)
);
