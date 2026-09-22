// Shared between src/app/api/savings-goals/**/route.ts (web) and
// src/local/repositories/savingsGoals.ts (on-device) so both validate identically — idea #6
// (premium-feature-ideas.md): "برای X، Y تومان تا فلان تاریخ" against a real linked account.
import { z } from "zod";
import { tomanInt } from "@/lib/schemas/money";
import { dayKeySchema } from "@/lib/schemas/day";

export const createSavingsGoalSchema = z.object({
  title: z.string().min(1).max(120),
  targetAmount: tomanInt().positive(),
  targetDate: dayKeySchema.optional(),
  accountId: z.string(),
});
export type CreateSavingsGoalInput = z.infer<typeof createSavingsGoalSchema>;

export const updateSavingsGoalSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  targetAmount: tomanInt().positive().optional(),
  targetDate: dayKeySchema.nullable().optional(),
  accountId: z.string().optional(),
});
export type UpdateSavingsGoalInput = z.infer<typeof updateSavingsGoalSchema>;
