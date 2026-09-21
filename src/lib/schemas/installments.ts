// Shared between src/app/api/installment-plans/**/route.ts + src/app/api/installments/**/route.ts
// (web) and src/local/repositories/installments.ts (on-device) so both validate identically —
// see the Android local-data-layer plan.
import { z } from "zod";
import { tomanInt } from "@/lib/schemas/money";
import { dayKeySchema } from "@/lib/schemas/day";

export const createInstallmentPlanSchema = z
  .object({
    title: z.string().min(1).max(150),
    totalAmount: tomanInt().positive(),
    installmentAmount: tomanInt().positive(),
    numberOfInstallments: z.number().int().positive().max(360),
    // Day of the JALALI month every installment falls on. Optional when firstDueDate is given —
    // that date's own Jalali day is used then.
    dueDay: z.number().int().min(1).max(31).optional(),
    // The date of the first installment. Later ones follow on the same Jalali day of each month.
    firstDueDate: dayKeySchema.optional(),
    startDate: z.string().datetime().optional(),
    notes: z.string().max(1000).optional(),
    reminderOffsets: z.array(z.number().int().min(0)).optional(),
  })
  .refine((v) => v.dueDay !== undefined || v.firstDueDate !== undefined, {
    message: "روز سررسید یا تاریخ اولین قسط را وارد کنید.",
    path: ["dueDay"],
  });
export type CreateInstallmentPlanInput = z.infer<typeof createInstallmentPlanSchema>;

// Scoped to the fields that don't risk corrupting a plan's financial history: totalAmount/
// installmentAmount/numberOfInstallments are left immutable since changing them after some
// installments are already PAID would make the existing schedule and past payments inconsistent.
// firstDueDate moves the whole schedule, so it is only accepted while nothing is paid yet.
export const updateInstallmentPlanSchema = z.object({
  title: z.string().min(1).max(150).optional(),
  dueDay: z.number().int().min(1).max(31).optional(),
  firstDueDate: dayKeySchema.optional(),
  notes: z.string().max(1000).optional(),
});
export type UpdateInstallmentPlanInput = z.infer<typeof updateInstallmentPlanSchema>;

export const payInstallmentSchema = z.object({ accountId: z.string() });
export type PayInstallmentInput = z.infer<typeof payInstallmentSchema>;
