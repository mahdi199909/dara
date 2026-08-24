import { addDays, addWeeks, addMonths, addYears } from "date-fns";
import type { RecurrenceFreq } from "./types";

export interface Occurrence {
  occurrenceId: string;
  startAt: Date;
  endAt: Date;
}

interface RecurringEventLike {
  id: string;
  startAt: Date;
  endAt: Date;
  recurrenceFreq: string;
  recurrenceInterval: number;
  recurrenceUntil: Date | null;
  recurrenceCount?: number | null;
}

const MAX_OCCURRENCES = 500;

function step(date: Date, freq: RecurrenceFreq, interval: number): Date {
  switch (freq) {
    case "DAILY":
      return addDays(date, interval);
    case "WEEKLY":
      return addWeeks(date, interval);
    case "MONTHLY":
      return addMonths(date, interval);
    case "YEARLY":
      return addYears(date, interval);
    default:
      return date;
  }
}

/**
 * Expands a (possibly recurring) event into concrete occurrences overlapping [rangeStart, rangeEnd].
 * A recurring series ends either by recurrenceUntil (a date) or recurrenceCount (after N
 * occurrences) — the UI only offers one at a time, but both are honored here if somehow set
 * together (whichever is reached first wins). occurrenceIndex is the ABSOLUTE 0-based index
 * from the series' first occurrence (event.startAt), not just within this query's range, so
 * occurrence ids stay stable across different range queries for the same event.
 */
export function expandOccurrences(event: RecurringEventLike, rangeStart: Date, rangeEnd: Date): Occurrence[] {
  const durationMs = event.endAt.getTime() - event.startAt.getTime();
  const freq = event.recurrenceFreq as RecurrenceFreq;

  if (freq === "NONE") {
    if (event.endAt >= rangeStart && event.startAt <= rangeEnd) {
      return [{ occurrenceId: event.id, startAt: event.startAt, endAt: event.endAt }];
    }
    return [];
  }

  const occurrences: Occurrence[] = [];
  let cursor = new Date(event.startAt);
  let occurrenceIndex = 0;

  while (cursor <= rangeEnd && occurrenceIndex < MAX_OCCURRENCES) {
    if (event.recurrenceUntil && cursor > event.recurrenceUntil) break;
    if (event.recurrenceCount != null && occurrenceIndex >= event.recurrenceCount) break;

    const occEnd = new Date(cursor.getTime() + durationMs);
    if (occEnd >= rangeStart) {
      occurrences.push({ occurrenceId: `${event.id}::${occurrenceIndex}`, startAt: new Date(cursor), endAt: occEnd });
    }

    cursor = step(cursor, freq, event.recurrenceInterval || 1);
    occurrenceIndex++;
  }

  return occurrences;
}
