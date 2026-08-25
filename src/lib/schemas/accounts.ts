// Shared between src/app/api/accounts/**/route.ts (web) and src/local/repositories/accounts.ts
// (on-device) so both validate identically — see the Android local-data-layer plan.
import { z } from "zod";
import { ACCOUNT_TYPES } from "@/lib/types";

export const createAccountSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(ACCOUNT_TYPES).optional(),
  initialBalance: z.number().int().optional(),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const updateAccountSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(ACCOUNT_TYPES).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
