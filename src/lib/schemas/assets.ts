// Shared between src/app/api/assets/**/route.ts (web) and src/local/repositories/assets.ts
// (on-device) so both validate identically — see the Android local-data-layer plan. Rules
// copied verbatim from those routes' own inline zod schemas (createSchema in assets/route.ts,
// updateSchema in assets/[id]/route.ts). The web routes are intentionally left untouched, so
// this file must be kept in sync by eye if those inline schemas ever change.
import { z } from "zod";

export const createAssetSchema = z.object({
  name: z.string().min(1).max(150),
  category: z.string().max(50).optional(),
  purchasePrice: z.number().int().min(0),
  purchaseDate: z.string().datetime().optional(),
  currentValue: z.number().int().min(0).optional(),
  notes: z.string().max(1000).optional(),
});
export type CreateAssetInput = z.infer<typeof createAssetSchema>;

export const updateAssetSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  category: z.string().max(50).nullable().optional(),
  currentValue: z.number().int().min(0).optional(),
  notes: z.string().max(1000).nullable().optional(),
});
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;
