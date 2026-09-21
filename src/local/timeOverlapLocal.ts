// The phone's side of the overlap check — see src/lib/timeOverlapServer.ts for the server's, and
// src/lib/timeOverlap.ts for the rules both share.
import { eventEntries, findOverlaps, overlapError, type TimedEntry, type TimedEntryKind } from "@/lib/timeOverlap";
import type { LocalDb } from "./db";

export function fetchTimedEntries(db: LocalDb, userId: string, range: { start: Date; end: Date }): TimedEntry[] {
  const startIso = range.start.toISOString();
  const endIso = range.end.toISOString();

  const tasks = db.all<{ id: string; title: string; startAt: string; endAt: string }>(
    `SELECT "id","title","startAt","endAt" FROM "Task"
     WHERE "userId" = ? AND "deletedAt" IS NULL AND "startAt" < ? AND "endAt" > ?`,
    [userId, endIso, startIso]
  );
  const timeEntries = db.all<{ id: string; title: string | null; startAt: string; endAt: string }>(
    `SELECT te."id", a."title", te."startAt", te."endAt" FROM "TimeEntry" te
     JOIN "Activity" a ON a."id" = te."activityId"
     WHERE a."userId" = ? AND a."deletedAt" IS NULL AND te."startAt" < ? AND te."endAt" > ?`,
    [userId, endIso, startIso]
  );
  // A recurring series started earlier can still reach into the range, so it is not bounded below by endAt.
  const events = db.all<{
    id: string;
    title: string;
    allDay: number;
    startAt: string;
    endAt: string;
    recurrenceFreq: string;
    recurrenceInterval: number;
    recurrenceUntil: string | null;
    recurrenceCount: number | null;
  }>(
    `SELECT "id","title","allDay","startAt","endAt","recurrenceFreq","recurrenceInterval","recurrenceUntil","recurrenceCount" FROM "Event"
     WHERE "userId" = ? AND "deletedAt" IS NULL AND "recurrenceParentId" IS NULL AND "allDay" = 0
       AND "startAt" < ? AND ("endAt" > ? OR "recurrenceFreq" != 'NONE')`,
    [userId, endIso, startIso]
  );

  return [
    ...tasks.map((t) => ({ kind: "TASK" as const, id: t.id, title: t.title, start: new Date(t.startAt), end: new Date(t.endAt) })),
    ...timeEntries.map((t) => ({ kind: "TIME_ENTRY" as const, id: t.id, title: t.title ?? "فعالیت", start: new Date(t.startAt), end: new Date(t.endAt) })),
    ...eventEntries(
      events.map((e) => ({
        id: e.id,
        title: e.title,
        allDay: !!e.allDay,
        startAt: new Date(e.startAt),
        endAt: new Date(e.endAt),
        recurrenceFreq: e.recurrenceFreq,
        recurrenceInterval: e.recurrenceInterval,
        recurrenceUntil: e.recurrenceUntil ? new Date(e.recurrenceUntil) : null,
        recurrenceCount: e.recurrenceCount,
      })),
      range
    ),
  ];
}

/** Same contract as the server's assertNoOverlap: throws the 409 (code TASK-002) unless the range is free or the caller chose to overlap. */
export function assertNoOverlap(
  db: LocalDb,
  userId: string,
  range: { start: Date; end: Date } | null,
  options: { allowOverlap?: boolean; self?: { kind: TimedEntryKind; id: string } } = {}
): void {
  if (!range || options.allowOverlap) return;
  const conflicts = findOverlaps(range, fetchTimedEntries(db, userId, range), options.self);
  if (conflicts.length > 0) throw overlapError(conflicts);
}
