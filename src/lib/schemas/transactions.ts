// Shared between src/app/api/transactions/**/route.ts (web) and
// src/local/repositories/transactions.ts (on-device) so both validate identically — see the
// Android local-data-layer plan.
import { z } from "zod";
import { TRANSACTION_TYPES } from "@/lib/types";

export const createTransactionSchema = z.object({
  type: z.enum(TRANSACTION_TYPES),
  amount: z.number().int().positive(),
  date: z.string().datetime().optional(),
  description: z.string().max(500).optional(),
  accountId: z.string(),
  transferToAccountId: z.string().optional(),
  categoryId: z.string().optional(),
  taskId: z.string().optional(),
  projectId: z.string().optional(),
  assetId: z.string().optional(),
  activityId: z.string().optional(),
});
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

export const updateTransactionSchema = z.object({
  amount: z.number().int().positive().optional(),
  date: z.string().datetime().optional(),
  description: z.string().max(500).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
});
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
