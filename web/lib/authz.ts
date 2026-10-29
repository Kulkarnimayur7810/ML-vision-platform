export const ROLES = ["owner", "admin", "ml_engineer", "annotator", "member"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", ml_engineer: "ML Engineer", annotator: "Annotator", member: "Project Member" };

export type Perm =
  | "workspace.view" | "workspace.manage" | "members.manage" | "invites.create"
  | "tasks.create" | "tasks.edit" | "tasks.edit_any" | "tasks.archive" | "board.configure" | "comments.create"
  | "datasets.create" | "datasets.edit" | "annotate" | "review"
  | "training.run" | "models.manage" | "docs.edit";

const all: Perm[] = ["workspace.view","workspace.manage","members.manage","invites.create","tasks.create","tasks.edit","tasks.edit_any","tasks.archive","board.configure","comments.create","datasets.create","datasets.edit","annotate","review","training.run","models.manage","docs.edit"];
const base: Perm[] = ["workspace.view", "tasks.create", "tasks.edit", "comments.create", "docs.edit"];

const TABLE: Record<Role, Set<Perm>> = {
  owner: new Set(all),
  admin: new Set(all.filter((p) => p !== "workspace.manage")),
  ml_engineer: new Set<Perm>([...base, "tasks.edit_any", "tasks.archive", "datasets.create", "datasets.edit", "annotate", "review", "training.run", "models.manage"]),
  annotator: new Set<Perm>([...base, "annotate"]),
  member: new Set<Perm>(base),
};
export const can = (role: Role, perm: Perm) => TABLE[role]?.has(perm) ?? false;
export const isRole = (v: string): v is Role => (ROLES as readonly string[]).includes(v);
