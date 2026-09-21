// Shared between src/app/api/tasks/**/route.ts (web) and src/local/repositories/tasks.ts
// (on-device) so both validate identically — see the Android local-data-layer plan.
import { z } from "zod";
import { tomanInt } from "@/lib/schemas/money";
import { TASK_STATUSES, VALUE_TYPES } from "@/lib/types";

export const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  dueDate: z.string().datetime().optional(),
  categoryId: z.string().optional(),
  projectId: z.string().optional(),
  estimatedCost: tomanInt().min(0).optional(),
  valueType: z.enum(VALUE_TYPES).optional(),
  directCost: tomanInt().min(0).optional(),
  incomeAmount: tomanInt().min(0).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  // Set by a client that already saw the overlap warning and chose to save anyway (see src/lib/timeOverlap.ts).
  allowOverlap: z.boolean().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  estimatedCost: tomanInt().min(0).nullable().optional(),
  valueType: z.enum(VALUE_TYPES).optional(),
  directCost: tomanInt().min(0).optional(),
  incomeAmount: tomanInt().min(0).optional(),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional(),
  // Set by a client that already saw the overlap warning and chose to save anyway (see src/lib/timeOverlap.ts).
  allowOverlap: z.boolean().optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
