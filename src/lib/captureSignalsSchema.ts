// The shape a line's signals travel in from the Android widget: its native parser writes them as JSON
// into the queue the app drains (src/local/widgetQueue.ts). Whatever the native code leaves out is the
// blank value, so it only has to write what it actually found; anything that is the wrong shape is
// refused rather than trusted.
import { z } from "zod";
import type { CaptureSignals } from "./captureSignals";

const daySignal = z.union([
  z.object({ type: z.literal("REL"), offset: z.number().int().min(-2).max(2) }),
  z.object({ type: z.literal("WEEKDAY"), day: z.number().int().min(0).max(6) }),
  z.object({ type: z.literal("JALALI"), jy: z.number().int().min(1300).max(1500).nullable(), jm: z.number().int().min(1).max(12), jd: z.number().int().min(1).max(31) }),
]);

const text = z.string().max(5000);
const toman = z.number().int().min(0).max(999_999_999_999_999);

export const captureSignalsSchema = z
  .object({
    kind: z.enum(["ENTRY", "INSTALLMENT_PLAN", "INSTALLMENT_PAY", "HABIT_CHECKIN", "HABIT_CREATE", "NOTE", "SAVINGS_GOAL", "PROJECT_CREATE", "BUDGET", "REMINDER"]),
    title: text,
    durationMinutes: z.number().int().min(0).max(525_600).nullable().optional(),
    amount: toman.nullable().optional(),
    income: z.boolean().optional(),
    day: daySignal.nullable().optional(),
    time: z.object({ h: z.number().int().min(0).max(23), m: z.number().int().min(0).max(59) }).nullable().optional(),
    categoryHint: text.nullable().optional(),
    projectHint: text.nullable().optional(),
    eventCue: z.boolean().optional(),
    count: z.number().int().min(1).max(360).nullable().optional(),
    perInstallment: z.boolean().optional(),
    dueDay: z.number().int().min(1).max(31).nullable().optional(),
    hint: text.nullable().optional(),
  })
  .transform(
    (s): CaptureSignals => ({
      v: 2,
      kind: s.kind,
      title: s.title,
      durationMinutes: s.durationMinutes ?? null,
      amount: s.amount ?? null,
      income: s.income ?? false,
      day: s.day ?? null,
      time: s.time ?? null,
      categoryHint: s.categoryHint ?? null,
      projectHint: s.projectHint ?? null,
      eventCue: s.eventCue ?? false,
      count: s.count ?? null,
      perInstallment: s.perInstallment ?? false,
      dueDay: s.dueDay ?? null,
      hint: s.hint ?? null,
    })
  );
