// Shared between src/app/api/categories/**/route.ts (web) and src/local/repositories/categories.ts
// (on-device) so both validate identically — see the Android local-data-layer plan.
import { z } from "zod";
import { tomanInt } from "@/lib/schemas/money";
import { CATEGORY_KINDS, VALUE_TYPES } from "@/lib/types";

export const createCategorySchema = z.object({
  name: z.string().min(1).max(50),
  icon: z.string().max(10).optional(),
  color: z.string().max(20).optional(),
  kind: z.enum(CATEGORY_KINDS).optional(),
  valueType: z.enum(VALUE_TYPES).optional(),
  generatesVirtualAsset: z.boolean().optional(),
  virtualAssetValuePerHour: tomanInt().min(0).optional(),
  // Must already exist and belong to the same user — checked server/repository-side, since a
  // Zod schema can't reach the database. One level only: a sub-category can't itself be given a
  // parentCategoryId that already has a parent (also checked there, not here).
  parentCategoryId: z.string().min(1).nullable().optional(),
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
  virtualAssetValuePerHour: tomanInt().min(0).nullable().optional(),
  parentCategoryId: z.string().min(1).nullable().optional(),
});
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

// Whole-list reorder: every one of the user's own category ids, in the order they should sort in
// from now on — see PATCH /api/categories/reorder. Simpler and less error-prone for a drag-sort
// UI than a series of one-off "move this category to position N" calls that all need to agree.
export const reorderCategoriesSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1),
});
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesSchema>;
