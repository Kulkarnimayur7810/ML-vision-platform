import type { Sql } from "../db";
export async function log(tx: Sql, workspaceId: string, actorId: string | null, action: string, entityType: string, entityId: string | null, summary: string) {
  await tx`insert into activity (workspace_id, actor_id, action, entity_type, entity_id, summary) values (${workspaceId}, ${actorId}, ${action}, ${entityType}, ${entityId}, ${summary})`;
}
export async function notify(tx: Sql, workspaceId: string, userId: string, kind: string, title: string, href: string | null) {
  await tx`insert into notifications (user_id, workspace_id, kind, title, href) values (${userId}, ${workspaceId}, ${kind}, ${title}, ${href})`;
}
