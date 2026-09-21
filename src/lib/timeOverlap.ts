// Two things done in the same stretch of time. The day battery has always resolved such overlaps
// silently (the later entry is truncated to whatever the earlier one leaves free), which is how a
// day ended up with activities lying on top of each other and no word about it. Saving a timed
// task or event now checks the range against everything else that occupies time and says so.
//
// Pure — the data comes from src/lib/timeOverlapServer.ts (Prisma) or src/local/timeOverlapLocal.ts
// (the phone's SQLite), and both hand their rows to the same functions below.
import { ApiError } from "./apiErrorBase";
import { expandOccurrences } from "./recurrence";
import { toPersianDigits } from "./money";

export type TimedEntryKind = "TASK" | "EVENT" | "TIME_ENTRY";

/** Something that occupies a stretch of time. */
export interface TimedEntry {
  kind: TimedEntryKind;
  id: string;
  title: string;
  start: Date;
  end: Date;
}

/** The JSON-safe form of a colliding entry — what the error response carries. */
export interface OverlapConflict {
  kind: TimedEntryKind;
  id: string;
  title: string;
  start: string;
  end: string;
}

const KIND_LABEL: Record<TimedEntryKind, string> = { TASK: "کار", EVENT: "رویداد", TIME_ENTRY: "فعالیت" };

/** Entries whose time overlaps `range`. Touching edges (one ends at 10:00, the next starts at 10:00) do not overlap. */
export function findOverlaps(range: { start: Date; end: Date }, entries: TimedEntry[], self?: { kind: TimedEntryKind; id: string }): TimedEntry[] {
  if (!(range.end.getTime() > range.start.getTime())) return [];
  return entries
    .filter((e) => !(self && e.kind === self.kind && e.id === self.id))
    .filter((e) => e.start.getTime() < range.end.getTime() && range.start.getTime() < e.end.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** The timed occurrences of some (possibly recurring) events inside `range`; all-day events do not occupy time. */
export function eventEntries(
  events: Array<{
    id: string;
    title: string;
    allDay: boolean;
    startAt: Date;
    endAt: Date;
    recurrenceFreq: string;
    recurrenceInterval: number;
    recurrenceUntil: Date | null;
    recurrenceCount?: number | null;
  }>,
  range: { start: Date; end: Date }
): TimedEntry[] {
  return events
    .filter((e) => !e.allDay)
    .flatMap((event) =>
      expandOccurrences(event, range.start, range.end).map((occ) => ({ kind: "EVENT" as const, id: event.id, title: event.title, start: occ.startAt, end: occ.endAt }))
    );
}

export function toConflict(entry: TimedEntry): OverlapConflict {
  return { kind: entry.kind, id: entry.id, title: entry.title, start: entry.start.toISOString(), end: entry.end.toISOString() };
}

/**
 * The Persian sentence a person reads: which entry the time collides with. It deliberately carries no
 * clock times — the server may run in another time zone than the person, so it would print the wrong
 * hours; the collisions travel in `details` with their instants and the screen formats them locally.
 */
export function overlapMessage(conflicts: Array<{ kind: TimedEntryKind; title: string }>): string {
  const first = conflicts[0];
  const rest = conflicts.length > 1 ? ` و ${toPersianDigits(conflicts.length - 1)} مورد دیگر` : "";
  return `این بازه با «${first.title}» (${KIND_LABEL[first.kind]})${rest} هم‌پوشانی دارد. زمان را تغییر دهید یا با هم‌پوشانی ثبت کنید.`;
}

/** The error a write is refused with. `code` TASK-002 lets the client show the collision and offer to save anyway. */
export function overlapError(conflicts: TimedEntry[]): ApiError {
  const list = conflicts.map(toConflict);
  return new ApiError(overlapMessage(conflicts), 409, "TASK-002", { conflicts: list });
}

/** What the request means to occupy: both ends present and in order, otherwise nothing to check. */
export function occupiedRange(start: Date | string | null | undefined, end: Date | string | null | undefined): { start: Date; end: Date } | null {
  if (!start || !end) return null;
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e.getTime() <= s.getTime()) return null;
  return { start: s, end: e };
}
