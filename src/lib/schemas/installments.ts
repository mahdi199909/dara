// Shared between src/app/api/installment-plans/**/route.ts + src/app/api/installments/**/route.ts
// (web) and src/local/repositories/installments.ts (on-device) so both validate identically —
// see the Android local-data-layer plan. Rules copied verbatim from those routes' own inline
// zod schemas (createSchema in installment-plans/route.ts, schema in installments/[id]/pay/route.ts).
// The web routes are intentionally left untouched, so this file must be kept in sync by eye if
// those inline schemas ever change.
import { z } from "zod";

export const createInstallmentPlanSchema = z.object({
  title: z.string().min(1).max(150),
  totalAmount: z.number().int().positive(),
  installmentAmount: z.number().int().positive(),
  numberOfInstallments: z.number().int().positive().max(360),
  dueDay: z.number().int().min(1).max(31),
  startDate: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
  reminderOffsets: z.array(z.number().int().min(0)).optional(),
});
export type CreateInstallmentPlanInput = z.infer<typeof createInstallmentPlanSchema>;

// Scoped to the fields that don't risk corrupting a plan's financial history: totalAmount/
// installmentAmount/numberOfInstallments are left immutable since changing them after some
// installments are already PAID would make the existing schedule and past payments inconsistent.
export const updateInstallmentPlanSchema = z.object({
  title: z.string().min(1).max(150).optional(),
  dueDay: z.number().int().min(1).max(31).optional(),
  notes: z.string().max(1000).optional(),
});
export type UpdateInstallmentPlanInput = z.infer<typeof updateInstallmentPlanSchema>;

export const payInstallmentSchema = z.object({ accountId: z.string() });
export type PayInstallmentInput = z.infer<typeof payInstallmentSchema>;
