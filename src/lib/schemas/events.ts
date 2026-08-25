// Shared between src/app/api/events/**/route.ts + src/app/api/reminders/**/route.ts (web) and
// src/local/repositories/events.ts (on-device) so both validate identically — see the Android
// local-data-layer plan. Rules copied verbatim from each route's inline zod schema; see
// src/local/repositories/events.ts's file header for the (intentional) asymmetries between
// the create and update schemas.
import { z } from "zod";
import { RECURRENCE_FREQS, VALUE_TYPES } from "@/lib/types";

export const createEventSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    allDay: z.boolean().optional(),
    location: z.string().max(200).optional(),
    categoryId: z.string().optional(),
    projectId: z.string().optional(),
    valueType: z.enum(VALUE_TYPES).optional(),
    directCost: z.number().int().min(0).optional(),
    incomeAmount: z.number().int().min(0).optional(),
    recurrenceFreq: z.enum(RECURRENCE_FREQS).optional(),
    recurrenceInterval: z.number().int().min(1).optional(),
    recurrenceUntil: z.string().datetime().nullable().optional(),
    recurrenceCount: z.number().int().min(1).max(500).nullable().optional(),
    reminderOffsets: z.array(z.number().int().min(0)).optional(),
  })
  .refine((b) => !(b.recurrenceUntil && b.recurrenceCount), {
    message: "پایان تکرار را یا با تاریخ یا با تعداد مشخص کنید، نه هر دو.",
  });
export type CreateEventInput = z.infer<typeof createEventSchema>;

// NOTE: the web route's update schema has no .refine() for the recurrenceUntil/recurrenceCount
// mutual exclusivity — that's only enforced on create. Reproduced faithfully (not a typo).
export const updateEventSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  allDay: z.boolean().optional(),
  location: z.string().max(200).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  valueType: z.enum(VALUE_TYPES).optional(),
  directCost: z.number().int().min(0).optional(),
  incomeAmount: z.number().int().min(0).optional(),
  recurrenceFreq: z.enum(RECURRENCE_FREQS).optional(),
  recurrenceInterval: z.number().int().min(1).optional(),
  recurrenceUntil: z.string().datetime().nullable().optional(),
  recurrenceCount: z.number().int().min(1).max(500).nullable().optional(),
});
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

// src/app/api/events/[id]/complete/route.ts's body schema.
export const toggleEventCompletionSchema = z.object({ occurrenceDate: z.string().datetime() });
export type ToggleEventCompletionInput = z.infer<typeof toggleEventCompletionSchema>;

// src/app/api/events/[id]/reminders/route.ts's body schema.
export const createReminderSchema = z.object({ offsetMinutes: z.number().int().min(0) });
export type CreateReminderInput = z.infer<typeof createReminderSchema>;
