// Turns one free-typed line ("امروز ۲ ساعت رو پروژه کار کردم، ۵۰۰ تومن هم خرج ناهار شد") into what
// CaptureForm needs to open pre-filled — the first, near-zero-cost piece of "premium feature idea
// #1" (see doc/premium-feature-ideas.md): src/lib/parser.ts already turns the text into a title,
// duration, amount, date and category hint; this file turns THAT into form fields, and nothing here
// ever gets saved without the person reviewing and submitting the (still fully editable) form —
// no number here is ever written to the database on its own.
import { parseQuickCapture } from "./parser";
import type { CaptureEntityType } from "./types";

export interface CapturePrefill {
  title: string;
  entityType: CaptureEntityType;
  /** The day only (local midnight) — never guessed further than what the text actually said. */
  day: Date | null;
  /** Set only when the text named a real clock time, or a duration let us anchor one — see below. */
  start: Date | null;
  end: Date | null;
  amount: number | null;
  flowType: "COST" | "INCOME"; // the parser has no income signal (yet) — money mentioned this way defaults to a cost
  /** A category NAME the caller matches against the person's real categories — never invented, never applied on its own. */
  categoryHint: string | null;
}

function atMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function buildCapturePrefill(rawInput: string, now: Date = new Date()): CapturePrefill {
  const parsed = parseQuickCapture(rawInput, now);
  // CaptureForm only ever makes a Task or an Event; a bare expense/activity becomes a Task (still
  // carries the cost/duration fields), a dated mention becomes an Event.
  const entityType: CaptureEntityType = parsed.suggestedType === "EVENT" ? "EVENT" : "TASK";

  let day: Date | null = null;
  let start: Date | null = null;
  let end: Date | null = null;

  if (parsed.date) {
    day = atMidnight(parsed.date);
    if (parsed.hasExplicitTime) {
      // A real clock time was named — take it exactly, and only add an end if a duration was named too.
      start = new Date(parsed.date);
      if (parsed.durationMinutes) end = new Date(start.getTime() + parsed.durationMinutes * 60_000);
    }
  }

  if (parsed.durationMinutes && !start) {
    // A length was named but no clock time — read as "I just finished doing this", the natural way
    // people describe something already done: it ends about now, on the day that was named (or
    // today, if none was), and started that many minutes before. Still just a starting point in an
    // editable form, not a fact recorded anywhere.
    const onDay = day ?? atMidnight(now);
    end = new Date(onDay.getFullYear(), onDay.getMonth(), onDay.getDate(), now.getHours(), now.getMinutes(), 0, 0);
    start = new Date(end.getTime() - parsed.durationMinutes * 60_000);
  }

  return {
    title: parsed.title,
    entityType,
    day,
    start,
    end,
    amount: parsed.amount,
    flowType: "COST",
    categoryHint: parsed.categoryHint,
  };
}
