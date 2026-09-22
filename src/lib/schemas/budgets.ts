// Shared between src/app/api/budgets/**/route.ts (web) and src/local/repositories/budgets.ts
// (on-device) so both validate identically — idea #5 (premium-feature-ideas.md): a soft monthly
// cap per category. One per category (Budget.categoryId is @unique — see prisma/schema.prisma),
// so create doubles as "replace the existing cap" in practice; the route layer still exposes it
// as ordinary id-based create/update/delete, same shape every other entity in this app uses.
import { z } from "zod";
import { tomanInt } from "@/lib/schemas/money";

export const createBudgetSchema = z.object({
  categoryId: z.string(),
  monthlyCap: tomanInt().positive(),
});
export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;

export const updateBudgetSchema = z.object({
  monthlyCap: tomanInt().positive(),
});
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;
