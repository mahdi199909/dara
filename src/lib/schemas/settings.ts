// Shared between src/app/api/settings/route.ts (web) and src/local/repositories/settings.ts
// (on-device) so both validate identically — see the Android local-data-layer plan.
import { z } from "zod";
import { CURRENCY_UNITS } from "@/lib/types";

export const updateSettingsSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  timezone: z.string().max(50).optional(),
  currency: z.string().max(10).optional(),
  currencyDisplayUnit: z.enum(CURRENCY_UNITS).optional(),
  calendarType: z.enum(["jalali", "gregorian"]).optional(),
  monthlyIncome: z.number().int().min(0).nullable().optional(),
  workingHoursMonth: z.number().int().min(1).max(744).nullable().optional(),
  hourlyValueOverride: z.number().int().min(0).nullable().optional(),
  dashboardCardPrefs: z.record(z.boolean()).optional(),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
