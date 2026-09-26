// On-device port of src/lib/journeyData.ts: the same rows for «مسیر», read from the phone's SQLite. The two must return
// exactly the same shape and decide the same way what "happened on a day" means — see the list at the top of that file.
import { dayKeyIso } from "@/lib/calendarGrid";
import { streakByDay } from "@/lib/journeyStreaks";
import { expandOccurrences } from "@/lib/recurrence";
import type { JourneyEventRow, JourneyHabitRow, JourneyMilestoneRow, JourneyNoteRow, JourneyRows, JourneyTaskRow, JourneyWorkRow } from "@/lib/journeyTypes";
import type { LocalDb } from "./db";

const minutesBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
const marks = (ids: unknown[]) => ids.map(() => "?").join(",");

/** The earliest thing this person ever recorded, as a "YYYY-MM-DD" day, or null when there is nothing at all. */
function findEarliestDay(db: LocalDb, userId: string): string | null {
  const min = (sql: string, params: unknown[] = [userId]) => db.get<Record<string, string | null>>(sql, params) ?? {};
  const event = min(`SELECT MIN("startAt") AS a FROM "Event" WHERE "userId" = ? AND "deletedAt" IS NULL AND "recurrenceParentId" IS NULL`);
  const task = min(`SELECT MIN("startAt") AS a, MIN("completedAt") AS b, MIN("dueDate") AS c FROM "Task" WHERE "userId" = ? AND "deletedAt" IS NULL AND "status" = 'DONE'`);
  const work = min(
    `SELECT MIN(te."startAt") AS a FROM "TimeEntry" te JOIN "Activity" a ON a."id" = te."activityId" WHERE a."userId" = ? AND a."deletedAt" IS NULL AND te."durationMin" IS NOT NULL`
  );
  const habit = min(`SELECT MIN(hc."date") AS a FROM "HabitCheckIn" hc JOIN "Habit" h ON h."id" = hc."habitId" WHERE h."userId" = ? AND h."deletedAt" IS NULL`);
  const note = min(`SELECT MIN("day") AS a FROM "DailyNote" WHERE "userId" = ? AND "deletedAt" IS NULL`);
  const project = min(`SELECT MIN("createdAt") AS a FROM "Project" WHERE "userId" = ? AND "deletedAt" IS NULL`);

  const days = [event.a, task.a, task.b, task.c, work.a, habit.a, project.a].filter((v): v is string => !!v).map((iso) => dayKeyIso(new Date(iso)));
  if (note.a) days.push(note.a);
  return days.length > 0 ? days.sort()[0] : null;
}

export function loadJourneyRows(db: LocalDb, userId: string, from: string, to: string): JourneyRows {
  // Events: every non-cancelled occurrence in the range, the recurring ones expanded, with which were ticked as done.
  const events = db.all<any>(
    `SELECT e.*, c."name" AS categoryName, p."name" AS projectName FROM "Event" e
       LEFT JOIN "Category" c ON c."id" = e."categoryId"
       LEFT JOIN "Project" p ON p."id" = e."projectId"
      WHERE e."userId" = ? AND e."deletedAt" IS NULL AND e."recurrenceParentId" IS NULL AND e."isCancelled" = 0`,
    [userId]
  );
  const completions = db.all<{ eventId: string; occurrenceDate: string }>(
    `SELECT ec."eventId", ec."occurrenceDate" FROM "EventCompletion" ec JOIN "Event" e ON e."id" = ec."eventId"
      WHERE e."userId" = ? AND ec."occurrenceDate" >= ? AND ec."occurrenceDate" <= ?`,
    [userId, from, to]
  );
  const done = new Set(completions.map((c) => `${c.eventId}|${new Date(c.occurrenceDate).getTime()}`));
  const rangeStart = new Date(from);
  const rangeEnd = new Date(to);
  const eventRows: JourneyEventRow[] = events.flatMap((e) =>
    expandOccurrences(
      {
        id: e.id,
        startAt: new Date(e.startAt),
        endAt: new Date(e.endAt),
        recurrenceFreq: e.recurrenceFreq,
        recurrenceInterval: e.recurrenceInterval,
        recurrenceUntil: e.recurrenceUntil ? new Date(e.recurrenceUntil) : null,
        recurrenceCount: e.recurrenceCount,
      },
      rangeStart,
      rangeEnd
    ).map((occurrence) => ({
      id: occurrence.occurrenceId,
      title: e.title,
      startAt: occurrence.startAt.toISOString(),
      endAt: occurrence.endAt.toISOString(),
      allDay: !!e.allDay,
      location: e.location ?? null,
      project: e.projectName ?? null,
      category: e.categoryName ?? null,
      done: done.has(`${e.id}|${occurrence.startAt.getTime()}`),
    }))
  );

  const tasks = db.all<any>(
    `SELECT t.*, c."name" AS categoryName, p."name" AS projectName FROM "Task" t
       LEFT JOIN "Category" c ON c."id" = t."categoryId"
       LEFT JOIN "Project" p ON p."id" = t."projectId"
      WHERE t."userId" = ? AND t."deletedAt" IS NULL AND t."status" = 'DONE' AND (
            (t."startAt" >= ? AND t."startAt" <= ?)
         OR (t."startAt" IS NULL AND t."completedAt" >= ? AND t."completedAt" <= ?)
         OR (t."startAt" IS NULL AND t."completedAt" IS NULL AND t."dueDate" >= ? AND t."dueDate" <= ?))`,
    [userId, from, to, from, to, from, to]
  );
  const taskRows: JourneyTaskRow[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    at: t.startAt ?? t.completedAt ?? t.dueDate ?? t.createdAt,
    minutes: t.startAt && t.endAt ? minutesBetween(t.startAt, t.endAt) : null,
    project: t.projectName ?? null,
    category: t.categoryName ?? null,
  }));

  const entries = db.all<any>(
    `SELECT te."id", te."startAt", te."durationMin", a."title", c."name" AS categoryName, p."name" AS projectName
       FROM "TimeEntry" te
       JOIN "Activity" a ON a."id" = te."activityId"
       LEFT JOIN "Category" c ON c."id" = a."categoryId"
       LEFT JOIN "Project" p ON p."id" = a."projectId"
      WHERE a."userId" = ? AND a."deletedAt" IS NULL AND te."startAt" >= ? AND te."startAt" <= ? AND te."durationMin" > 0`,
    [userId, from, to]
  );
  const workRows: JourneyWorkRow[] = entries.map((e) => ({
    id: e.id,
    title: e.title,
    startAt: e.startAt,
    minutes: e.durationMin ?? 0,
    project: e.projectName ?? null,
    category: e.categoryName ?? null,
  }));

  const checkIns = db.all<{ id: string; habitId: string; date: string; createdAt: string; durationMin: number | null; title: string }>(
    `SELECT hc."id", hc."habitId", hc."date", hc."createdAt", hc."durationMin", h."title"
       FROM "HabitCheckIn" hc JOIN "Habit" h ON h."id" = hc."habitId"
      WHERE h."userId" = ? AND h."deletedAt" IS NULL AND hc."date" >= ? AND hc."date" <= ?`,
    [userId, from, to]
  );
  // A streak needs each habit's whole history up to the end of the range, not just the days inside it.
  const habitIds = [...new Set(checkIns.map((c) => c.habitId))];
  const history = habitIds.length
    ? db.all<{ habitId: string; date: string }>(`SELECT "habitId","date" FROM "HabitCheckIn" WHERE "habitId" IN (${marks(habitIds)}) AND "date" <= ?`, [...habitIds, to])
    : [];
  const daysByHabit = new Map<string, string[]>();
  for (const h of history) daysByHabit.set(h.habitId, [...(daysByHabit.get(h.habitId) ?? []), dayKeyIso(new Date(h.date))]);
  const streaks = new Map<string, Map<string, number>>();
  for (const [habitId, days] of daysByHabit) streaks.set(habitId, streakByDay(days));
  const habitRows: JourneyHabitRow[] = checkIns.map((c) => ({
    id: c.id,
    habitId: c.habitId,
    title: c.title,
    date: c.date,
    at: c.createdAt,
    minutes: c.durationMin,
    streak: streaks.get(c.habitId)?.get(dayKeyIso(new Date(c.date))) ?? 1,
  }));

  const notes = db.all<{ id: string; day: string; content: string; createdAt: string }>(
    `SELECT "id","day","content","createdAt" FROM "DailyNote"
      WHERE "userId" = ? AND "deletedAt" IS NULL AND "day" >= ? AND "day" <= ? ORDER BY "day" ASC, "createdAt" ASC`,
    [userId, dayKeyIso(rangeStart), dayKeyIso(rangeEnd)]
  );
  const noteRows: JourneyNoteRow[] = notes.map((n) => ({ id: n.id, day: n.day, text: n.content, createdAt: n.createdAt }));

  const projects = db.all<{ id: string; name: string; createdAt: string; completedAt: string | null }>(
    `SELECT "id","name","createdAt","completedAt" FROM "Project"
      WHERE "userId" = ? AND "deletedAt" IS NULL AND (("createdAt" >= ? AND "createdAt" <= ?) OR ("completedAt" >= ? AND "completedAt" <= ?))`,
    [userId, from, to, from, to]
  );
  const milestones: JourneyMilestoneRow[] = [];
  for (const p of projects) {
    if (p.createdAt >= from && p.createdAt <= to) milestones.push({ id: `${p.id}:start`, kind: "STARTED", name: p.name, at: p.createdAt });
    if (p.completedAt && p.completedAt >= from && p.completedAt <= to) milestones.push({ id: `${p.id}:end`, kind: "COMPLETED", name: p.name, at: p.completedAt });
  }

  return { events: eventRows, tasks: taskRows, work: workRows, habits: habitRows, notes: noteRows, milestones, earliestDay: findEarliestDay(db, userId) };
}
