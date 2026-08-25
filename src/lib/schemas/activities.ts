// Shared between src/app/api/activities/**/route.ts (web) and
// src/local/repositories/activities.ts (on-device) so both validate identically — see the
// Android local-data-layer plan.
//
// Note: the web routes' GET /api/activities (list) handler takes from/to/projectId/categoryId/
// limit query params but never runs them through zod at all (just raw searchParams reads +
// Math.min/Number for limit) — so there's deliberately no schema for that here either.
// Same for the timer start/stop routes, which have no request body.
import { z } from "zod";

export const createActivitySchema = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
  categoryId: z.string().optional(),
  taskId: z.string().optional(),
  projectId: z.string().optional(),
  directCost: z.number().int().min(0).optional(),
  durationMin: z.number().int().min(0).optional(),
  startTimerNow: z.boolean().optional(),
});
export type CreateActivityInput = z.infer<typeof createActivitySchema>;

export const updateActivitySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  directCost: z.number().int().min(0).optional(),
});
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;

export const addTimeEntrySchema = z.object({
  durationMin: z.number().int().min(1).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
});
export type AddTimeEntryInput = z.infer<typeof addTimeEntrySchema>;
