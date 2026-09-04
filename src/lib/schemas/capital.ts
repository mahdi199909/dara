import { z } from "zod";

/** Which CapitalSnapshot window /capital's growth chart requests — see src/app/api/capital/route.ts. */
export const capitalRangeSchema = z.enum(["30", "90", "all"]).default("30");
export type CapitalRange = z.infer<typeof capitalRangeSchema>;
