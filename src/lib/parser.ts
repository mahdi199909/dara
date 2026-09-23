// A typed line read as ONE ENTRY — a task, an event, logged time or a purchase/income — with the
// clock applied to it. The words themselves are read by src/lib/captureSignals.ts (which the Android
// widget's parser mirrors); this file gives their day and time a real date, and decides which kind of
// entry the mix of signals adds up to. src/lib/captureIntent.ts is the layer above, which first asks
// whether the line is an entry at all or one of the other things a line can create (a note, an
// installment plan, a habit tick ...).
import { fromJalali, toJalali } from "./jalali";
import { extractEntrySignals, type CaptureSignals, type DaySignal } from "./captureSignals";
import jalaali from "jalaali-js";

export type CaptureType = "TASK" | "ACTIVITY" | "EVENT" | "EXPENSE" | "INCOME";

export interface ParsedCapture {
  title: string;
  durationMinutes: number | null;
  amount: number | null;
  /** The amount came in (salary, a sale ...) rather than going out. */
  income: boolean;
  date: Date | null;
  hasExplicitTime: boolean;
  categoryHint: string | null;
  /** A project name (or a fragment of one — "پروژه اتاق" for a project actually named "بازسازی
   * اتاق") pulled out of "پروژه ..." / "... برای پروژه ..." — fuzzy-matched against the person's
   * real projects by the caller (src/lib/smartCapture.ts), same "hint, not a fact" contract as
   * categoryHint. */
  projectHint: string | null;
  suggestedType: CaptureType;
}

function atMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Local midnight of the day a DaySignal names, relative to `now`. */
export function resolveDaySignal(signal: DaySignal, now: Date): Date {
  const today = atMidnight(now);
  if (signal.type === "REL") return new Date(today.getFullYear(), today.getMonth(), today.getDate() + signal.offset);
  if (signal.type === "WEEKDAY") {
    // The next such day, never today: «شنبه» said on a Saturday means next week's.
    const diff = ((signal.day - today.getDay() + 6) % 7) + 1;
    return new Date(today.getFullYear(), today.getMonth(), today.getDate() + diff);
  }
  const jy = signal.jy ?? toJalali(now).jy;
  // A day the month does not have (the 31st of Mehr..Bahman, the 30th of Esfand) is that month's last.
  return fromJalali(jy, signal.jm, Math.min(signal.jd, jalaali.jalaaliMonthLength(jy, signal.jm)));
}

/** What a set of ENTRY signals adds up to on the day it was typed. */
export function parsedFromSignals(s: CaptureSignals, now: Date): ParsedCapture {
  let date: Date | null = null;
  const hasExplicitTime = s.time !== null;
  if (s.day || s.time) {
    date = s.day ? resolveDaySignal(s.day, now) : atMidnight(now);
    if (s.time) date.setHours(s.time.h, s.time.m, 0, 0);
    else date.setHours(9, 0, 0, 0);
  }

  let suggestedType: CaptureType;
  if (s.durationMinutes !== null && s.amount !== null) suggestedType = "ACTIVITY";
  else if (s.amount !== null) suggestedType = s.income ? "INCOME" : "EXPENSE";
  else if (date !== null || s.eventCue) suggestedType = "EVENT"; // duration (if any) becomes the event length, not logged time
  else if (s.durationMinutes !== null) suggestedType = "ACTIVITY";
  else suggestedType = "TASK";

  return {
    title: s.title,
    durationMinutes: s.durationMinutes,
    amount: s.amount,
    income: s.income,
    date,
    hasExplicitTime,
    categoryHint: s.categoryHint,
    projectHint: s.projectHint,
    suggestedType,
  };
}

export function parseQuickCapture(rawInput: string, now: Date = new Date()): ParsedCapture {
  return parsedFromSignals(extractEntrySignals(rawInput), now);
}
