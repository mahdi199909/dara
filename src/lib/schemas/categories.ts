// Shared between src/app/api/categories/**/route.ts (web) and src/local/repositories/categories.ts
// (on-device) so both validate identically — see the Android local-data-layer plan.
import { z } from "zod";
import { CATEGORY_KINDS, VALUE_TYPES } from "@/lib/types";

export const createCategorySchema = z.object({
  name: z.string().min(1).max(50),
  icon: z.string().max(10).optional(),
  color: z.string().max(20).optional(),
  kind: z.enum(CATEGORY_KINDS).optional(),
  valueType: z.enum(VALUE_TYPES).optional(),
  generatesVirtualAsset: z.boolean().optional(),
  virtualAssetValuePerHour: z.number().int().min(0).optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z.object({
  name: z.string().min(1).max(50).optional(),
  icon: z.string().max(10).optional(),
  color: z.string().max(20).optional(),
  kind: z.enum(CATEGORY_KINDS).optional(),
  valueType: z.enum(VALUE_TYPES).optional(),
  isActive: z.boolean().optional(),
  generatesVirtualAsset: z.boolean().optional(),
  virtualAssetValuePerHour: z.number().int().min(0).nullable().optional(),
});
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
