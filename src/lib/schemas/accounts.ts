// Shared between src/app/api/accounts/**/route.ts (web) and src/local/repositories/accounts.ts
// (on-device) so both validate identically — see the Android local-data-layer plan.
import { z } from "zod";
import { tomanInt } from "@/lib/schemas/money";
import { ACCOUNT_TYPES } from "@/lib/types";

// A name of only spaces is no name: it is trimmed first, so "   " is refused like "" (the forms check it as well, but this is the gate).
export const createAccountSchema = z.object({
  name: z.string().trim().min(1, "نام حساب خالی است.").max(100),
  type: z.enum(ACCOUNT_TYPES).optional(),
  initialBalance: tomanInt().optional(),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const updateAccountSchema = z.object({
  name: z.string().trim().min(1, "نام حساب خالی است.").max(100).optional(),
  type: z.enum(ACCOUNT_TYPES).optional(),
  isActive: z.boolean().optional(),
  // true makes this the account new expenses and income go to, and takes the mark off the others.
  isDefault: z.boolean().optional(),
});
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
