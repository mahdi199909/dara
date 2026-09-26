// Shared between src/app/api/journey/route.ts (web) and the phone's own route for it (src/lib/localDispatcher.ts) so
// both validate identically.
import { z } from "zod";

/** One story chapter is one Jalali month (≤ 31 days); three months is more than any screen asks for at once. */
export const JOURNEY_MAX_RANGE_DAYS = 93;

/** `?from=&to=` — the instants to read (ISO, UTC), both included. */
export const journeyQuerySchema = z
  .object({ from: z.string().datetime(), to: z.string().datetime() })
  .refine((q) => new Date(q.from).getTime() <= new Date(q.to).getTime(), { message: "ابتدای بازه نباید بعد از انتهای آن باشد." })
  .refine((q) => new Date(q.to).getTime() - new Date(q.from).getTime() <= JOURNEY_MAX_RANGE_DAYS * 86_400_000, { message: "بازه‌ی مسیر بیش از حد بلند است." });
export type JourneyQuery = z.infer<typeof journeyQuerySchema>;
