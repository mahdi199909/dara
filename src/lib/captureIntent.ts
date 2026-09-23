// What a typed line MEANS, on the day it was typed: the words read by src/lib/captureSignals.ts (which
// the Android widget's parser mirrors) given real dates and amounts. One line becomes exactly one
// intent — an entry (task / event / logged time / expense / income), or one of the other things the
// app has a screen for. Nothing here touches the database; src/lib/captureResolve.ts finds what the
// words point at (which habit, which plan) and turns an intent into the calls that carry it out.
import { extractEntrySignals, extractSignals, type CaptureSignals } from "./captureSignals";
import { parsedFromSignals, resolveDaySignal } from "./parser";
import { prefillFromParsed, type CapturePrefill } from "./smartCapture";
import { dayKeyIso } from "./calendarGrid";
import { toJalali } from "./jalali";

export type CaptureIntent =
  | { kind: "ENTRY"; prefill: CapturePrefill }
  | { kind: "REMINDER"; title: string; start: Date; end: Date }
  | { kind: "INSTALLMENT_PLAN"; title: string; count: number; installmentAmount: number; totalAmount: number; dueDay: number }
  | { kind: "INSTALLMENT_PAY"; planHint: string }
  | { kind: "HABIT_CHECKIN"; habitHint: string; date: Date }
  | { kind: "HABIT_CREATE"; title: string }
  | { kind: "NOTE"; content: string; day: string }
  | { kind: "SAVINGS_GOAL"; title: string; targetAmount: number }
  | { kind: "PROJECT_CREATE"; name: string }
  | { kind: "BUDGET"; categoryHint: string; monthlyCap: number };

/** How long a reminder's event lasts — it is a point in time, this only gives it a body on the calendar. */
const REMINDER_EVENT_MINUTES = 30;
/** The hour a reminder for a named day without a time goes off. */
const REMINDER_DEFAULT_HOUR = 9;

function atMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The signals of one line (from src/lib/captureSignals.ts, or from the widget's own parser) given meaning. */
export function intentFromSignals(s: CaptureSignals, now: Date): CaptureIntent {
  switch (s.kind) {
    case "REMINDER": {
      const day = s.day ? resolveDaySignal(s.day, now) : atMidnight(now);
      let start: Date;
      if (s.time) {
        start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), s.time.h, s.time.m, 0, 0);
      } else if (s.day) {
        start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), REMINDER_DEFAULT_HOUR, 0, 0, 0);
      } else {
        // «یادم باشه ...» with no time: the next whole hour, so it goes off soon rather than never.
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0);
      }
      return { kind: "REMINDER", title: s.title, start, end: new Date(start.getTime() + REMINDER_EVENT_MINUTES * 60_000) };
    }
    case "INSTALLMENT_PLAN": {
      const count = s.count ?? 1;
      const amount = s.amount ?? 0;
      const installmentAmount = s.perInstallment ? amount : Math.round(amount / count);
      const totalAmount = s.perInstallment ? amount * count : amount;
      // No day named: the same day of the Jalali month as today, starting next month.
      return { kind: "INSTALLMENT_PLAN", title: s.title, count, installmentAmount, totalAmount, dueDay: s.dueDay ?? toJalali(now).jd };
    }
    case "INSTALLMENT_PAY":
      return { kind: "INSTALLMENT_PAY", planHint: s.hint ?? "" };
    case "HABIT_CHECKIN":
      return { kind: "HABIT_CHECKIN", habitHint: s.hint ?? "", date: atMidnight(now) };
    case "HABIT_CREATE":
      return { kind: "HABIT_CREATE", title: s.title };
    case "NOTE":
      return { kind: "NOTE", content: s.title, day: dayKeyIso(s.day ? resolveDaySignal(s.day, now) : now) };
    case "SAVINGS_GOAL":
      return { kind: "SAVINGS_GOAL", title: s.title, targetAmount: s.amount ?? 0 };
    case "PROJECT_CREATE":
      return { kind: "PROJECT_CREATE", name: s.title };
    case "BUDGET":
      return { kind: "BUDGET", categoryHint: s.hint ?? "", monthlyCap: s.amount ?? 0 };
    default:
      return { kind: "ENTRY", prefill: prefillFromParsed(parsedFromSignals(s, now), now) };
  }
}

/**
 * Reads one typed line. `forceEntry` skips the keyword guesses and reads the line as a plain entry —
 * the answer to "no, that's just a task" on a confirmation card.
 */
export function parseCaptureIntent(raw: string, now: Date = new Date(), options?: { forceEntry?: boolean }): CaptureIntent {
  return intentFromSignals(options?.forceEntry ? extractEntrySignals(raw) : extractSignals(raw), now);
}
