import { z } from "zod";
export const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable();
export const priority = z.enum(["urgent", "high", "medium", "low"]);
export const newTask = z.object({
  title: z.string().min(1).max(200), description: z.string().max(20000).optional(), columnId: uuid.optional(), priority: priority.optional(),
  assigneeIds: z.array(uuid).max(20).optional(), labelIds: z.array(uuid).max(20).optional(),
  dueDate: date.optional(), startDate: date.optional(), workstream: z.string().max(60).nullable().optional(), parentId: uuid.nullable().optional(),
});
export const taskPatch = z.object({
  version: z.number().int(), title: z.string().max(200).optional(), description: z.string().max(20000).optional(), priority: priority.optional(),
  workstream: z.string().max(60).nullable().optional(), dueDate: date.optional(), startDate: date.optional(),
  assigneeIds: z.array(uuid).max(20).optional(), labelIds: z.array(uuid).max(20).optional(), parentId: uuid.nullable().optional(),
});
export const role = z.enum(["admin", "ml_engineer", "annotator", "member"]);
