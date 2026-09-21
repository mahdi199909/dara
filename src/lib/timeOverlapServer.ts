// The server's side of the overlap check: read what else occupies time around a range (Prisma),
// then let the shared rules in ./timeOverlap decide. The phone does the same from its own SQLite in
// src/local/timeOverlapLocal.ts.
import { prisma } from "@/lib/db";
import { eventEntries, findOverlaps, overlapError, type TimedEntry, type TimedEntryKind } from "@/lib/timeOverlap";

/** Everything that runs during `range` — tasks and finished time entries with both ends, and timed events (recurring ones expanded). */
export async function fetchTimedEntries(userId: string, range: { start: Date; end: Date }): Promise<TimedEntry[]> {
  const [tasks, timeEntries, events] = await Promise.all([
    prisma.task.findMany({
      where: { userId, deletedAt: null, startAt: { lt: range.end }, endAt: { gt: range.start } },
      select: { id: true, title: true, startAt: true, endAt: true },
    }),
    prisma.timeEntry.findMany({
      where: { activity: { userId, deletedAt: null }, startAt: { lt: range.end }, endAt: { gt: range.start } },
      select: { id: true, startAt: true, endAt: true, activity: { select: { title: true } } },
    }),
    // A recurring series started earlier can still reach into the range, so it is not bounded below by endAt.
    prisma.event.findMany({
      where: {
        userId,
        deletedAt: null,
        recurrenceParentId: null,
        allDay: false,
        startAt: { lt: range.end },
        OR: [{ endAt: { gt: range.start } }, { recurrenceFreq: { not: "NONE" } }],
      },
      select: { id: true, title: true, allDay: true, startAt: true, endAt: true, recurrenceFreq: true, recurrenceInterval: true, recurrenceUntil: true, recurrenceCount: true },
    }),
  ]);

  return [
    ...tasks.map((t) => ({ kind: "TASK" as const, id: t.id, title: t.title, start: t.startAt!, end: t.endAt! })),
    ...timeEntries.map((t) => ({ kind: "TIME_ENTRY" as const, id: t.id, title: t.activity.title ?? "فعالیت", start: t.startAt, end: t.endAt! })),
    ...eventEntries(events, range),
  ];
}

/**
 * Refuses (409, code TASK-002, with the colliding entries as `details`) when `range` overlaps something
 * else — unless the caller already saw that and chose to save anyway (`allowOverlap`). `self` is the entry
 * being edited, which never collides with itself.
 */
export async function assertNoOverlap(
  userId: string,
  range: { start: Date; end: Date } | null,
  options: { allowOverlap?: boolean; self?: { kind: TimedEntryKind; id: string } } = {}
): Promise<void> {
  if (!range || options.allowOverlap) return;
  const conflicts = findOverlaps(range, await fetchTimedEntries(userId, range), options.self);
  if (conflicts.length > 0) throw overlapError(conflicts);
}
