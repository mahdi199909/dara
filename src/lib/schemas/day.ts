import { z } from "zod";
import { parseDayKey } from "@/lib/calendarGrid";

// A calendar day as "YYYY-MM-DD" (Gregorian digits, no time, no zone) — the key the calendar grid
// buckets by (dayKeyIso). Pickers hand over the day the person chose as this key, so neither the
// server nor the phone ever has to guess which day an instant falls on in the caller's time zone.
export const dayKeySchema = z.string().refine((v) => parseDayKey(v) !== null, { message: "تاریخ معتبر نیست." });
