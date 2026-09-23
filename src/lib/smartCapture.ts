// Turns one free-typed line ("امروز ۲ ساعت رو پروژه کار کردم، ۵۰۰ تومن هم خرج ناهار شد") into what
// CaptureForm needs to open pre-filled — the first, near-zero-cost piece of "premium feature idea
// #1" (see doc/premium-feature-ideas.md): src/lib/parser.ts already turns the text into a title,
// duration, amount, date and category hint; this file turns THAT into form fields, and nothing here
// ever gets saved without the person reviewing and submitting the (still fully editable) form —
// no number here is ever written to the database on its own.
import { parseQuickCapture, type ParsedCapture } from "./parser";
import type { CaptureEntityType } from "./types";

export interface CapturePrefill {
  title: string;
  entityType: CaptureEntityType;
  /** The day only (local midnight) — never guessed further than what the text actually said. */
  day: Date | null;
  /** Falls back to the current clock time (on whatever day was named, or today) when the text gave
   * neither a real time nor a duration to anchor one — see below. Practically never null. */
  start: Date | null;
  end: Date | null;
  amount: number | null;
  flowType: "COST" | "INCOME"; // money that came in (salary, a sale ...) is income; any other amount mentioned is a cost
  /** A category NAME the caller matches against the person's real categories — never invented, never applied on its own. */
  categoryHint: string | null;
  /** A project NAME or a fragment of one — the caller fuzzy-matches it against the person's real
   * projects, and only ever creates a new one after the person confirms (see SmartCaptureConfirm). */
  projectHint: string | null;
}

function atMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function buildCapturePrefill(rawInput: string, now: Date = new Date()): CapturePrefill {
  return prefillFromParsed(parseQuickCapture(rawInput, now), now);
}

/** An already-parsed entry as the form's starting point — see buildCapturePrefill. */
export function prefillFromParsed(parsed: ParsedCapture, now: Date): CapturePrefill {
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

  if (!start) {
    // Neither a clock time nor a duration to anchor one — rather than leave the person to fill in
    // a time by hand for the common case (quickly logging something as it happens), default to
    // right now, on whichever day was named (or today). No end is invented alongside it — a
    // duration is a real claim about length that the text never made.
    const onDay = day ?? atMidnight(now);
    start = new Date(onDay.getFullYear(), onDay.getMonth(), onDay.getDate(), now.getHours(), now.getMinutes(), 0, 0);
  }

  return {
    title: parsed.title,
    entityType,
    day,
    start,
    end,
    amount: parsed.amount,
    flowType: parsed.income ? "INCOME" : "COST",
    categoryHint: parsed.categoryHint,
    projectHint: parsed.projectHint,
  };
}

interface MatchableCategory {
  id: string;
  name: string;
  isActive: boolean;
  projectId?: string | null;
}

/** Same exact-or-substring match CaptureForm has always used for a plain category hint. */
export function matchCategoryHint<T extends MatchableCategory>(hint: string, categories: T[]): T | null {
  return categories.find((c) => c.isActive && (c.name === hint || c.name.includes(hint))) ?? null;
}

/** A project hint is looser than a category one on purpose — the person may only remember a
 * fragment of the project's name ("پروژه اتاق" for a project actually called "بازسازی اتاق"), so
 * this also matches on any single shared word, not just a substring either direction. Only
 * candidates a project actually generated (categoryId's `projectId` set) are eligible — a category
 * that merely happens to share a word with the hint but isn't a project's own category must never
 * silently tag an entry to a project it has nothing to do with. */
export function matchProjectHint<T extends MatchableCategory>(hint: string, categories: T[]): T | null {
  const candidates = categories.filter((c) => c.isActive && c.projectId);
  const exact = candidates.find((c) => c.name === hint || c.name.includes(hint) || hint.includes(c.name));
  if (exact) return exact;

  const hintWords = hint.split(/\s+/).filter(Boolean);
  return candidates.find((c) => {
    const nameWords = c.name.split(/\s+/).filter(Boolean);
    return hintWords.some((w) => nameWords.includes(w));
  }) ?? null;
}
