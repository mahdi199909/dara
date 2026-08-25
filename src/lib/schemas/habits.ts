// Shared between src/app/api/habits/**/route.ts (web) and src/local/repositories/habits.ts
// (on-device) so both validate identically — see the Android local-data-layer plan.
import { z } from "zod";

export const createHabitSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  icon: z.string().max(8).nullable().optional(),
  color: z.string().max(20).optional(),
  categoryId: z.string().nullable().optional(),
  virtualAssetValuePerCheckIn: z.number().int().min(0).optional(),
  // BJ Fogg "Tiny Habits" trial — see the isTrial doc comment on the Habit model.
  isTrial: z.boolean().optional(),
  cue: z.string().max(300).nullable().optional(),
  celebration: z.string().max(300).nullable().optional(),
});
export type CreateHabitInput = z.infer<typeof createHabitSchema>;

export const updateHabitSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  icon: z.string().max(8).nullable().optional(),
  color: z.string().max(20).optional(),
  categoryId: z.string().nullable().optional(),
  virtualAssetValuePerCheckIn: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  // isTrial: false promotes a trial habit to a permanent one (see the Habit model doc).
  isTrial: z.boolean().optional(),
  cue: z.string().max(300).nullable().optional(),
  celebration: z.string().max(300).nullable().optional(),
});
export type UpdateHabitInput = z.infer<typeof updateHabitSchema>;

// From src/app/api/habits/[id]/checkin/route.ts's POST handler (toggles today's check-in).
export const habitCheckInToggleSchema = z.object({ date: z.string().datetime().optional() });
export type HabitCheckInToggleInput = z.infer<typeof habitCheckInToggleSchema>;

// From the same file's PATCH handler (logs a duration against today's check-in).
export const habitCheckInDurationSchema = z.object({
  date: z.string().datetime().optional(),
  durationMin: z.number().int().min(0).max(1440),
});
export type HabitCheckInDurationInput = z.infer<typeof habitCheckInDurationSchema>;
