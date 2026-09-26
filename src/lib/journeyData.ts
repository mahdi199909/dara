// The web app's side of «مسیر»: read what happened between two instants (Prisma) and hand it to the story engine as
// plain rows. The phone does the same from its own SQLite in src/local/journeyData.ts — both must return exactly the
// shape in src/lib/journeyTypes.ts, and both decide the same way what "happened on a day" means:
//   · an event — every non-cancelled occurrence, recurring ones expanded (the calendar's rule);
//   · a task — done, on the day it was done (its logged start, else its completion, else its due day);
//   · work — a finished stretch of tracked time;
//   · a habit — a check-in, with how many days in a row that habit had been done by then;
//   · a note — the person's own daily notes;
//   · a landmark — a project that began or ended.
// Money is deliberately not part of the story yet.
import { prisma } from "@/lib/db";
import { dayKeyIso } from "@/lib/calendarGrid";
import { expandOccurrences } from "@/lib/recurrence";
import { streakByDay } from "@/lib/journeyStreaks";
import type { JourneyEventRow, JourneyHabitRow, JourneyMilestoneRow, JourneyNoteRow, JourneyRows, JourneyTaskRow, JourneyWorkRow } from "@/lib/journeyTypes";

const minutesBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));

/** The earliest thing this person ever recorded, as a "YYYY-MM-DD" day, or null when there is nothing at all. */
async function findEarliestDay(userId: string): Promise<string | null> {
  const [event, task, work, habit, note, project] = await Promise.all([
    prisma.event.aggregate({ where: { userId, deletedAt: null, recurrenceParentId: null }, _min: { startAt: true } }),
    prisma.task.aggregate({ where: { userId, deletedAt: null, status: "DONE" }, _min: { startAt: true, completedAt: true, dueDate: true } }),
    prisma.timeEntry.aggregate({ where: { activity: { userId, deletedAt: null }, durationMin: { not: null } }, _min: { startAt: true } }),
    prisma.habitCheckIn.aggregate({ where: { habit: { userId, deletedAt: null } }, _min: { date: true } }),
    prisma.dailyNote.aggregate({ where: { userId, deletedAt: null }, _min: { day: true } }),
    prisma.project.aggregate({ where: { userId, deletedAt: null }, _min: { createdAt: true } }),
  ]);
  const days = [
    event._min.startAt,
    task._min.startAt,
    task._min.completedAt,
    task._min.dueDate,
    work._min.startAt,
    habit._min.date,
    project._min.createdAt,
  ]
    .filter((d): d is Date => !!d)
    .map((d) => dayKeyIso(d));
  if (note._min.day) days.push(note._min.day);
  return days.length > 0 ? days.sort()[0] : null;
}

export async function loadJourneyRows(userId: string, from: Date, to: Date): Promise<JourneyRows> {
  const [events, tasks, timeEntries, checkIns, notes, projects, earliestDay] = await Promise.all([
    prisma.event.findMany({
      where: { userId, deletedAt: null, recurrenceParentId: null, isCancelled: false },
      include: { category: { select: { name: true } }, project: { select: { name: true } } },
    }),
    prisma.task.findMany({
      where: {
        userId,
        deletedAt: null,
        status: "DONE",
        OR: [
          { startAt: { gte: from, lte: to } },
          { startAt: null, completedAt: { gte: from, lte: to } },
          { startAt: null, completedAt: null, dueDate: { gte: from, lte: to } },
        ],
      },
      include: { category: { select: { name: true } }, project: { select: { name: true } } },
    }),
    prisma.timeEntry.findMany({
      where: { activity: { userId, deletedAt: null }, startAt: { gte: from, lte: to }, durationMin: { gt: 0 } },
      include: { activity: { select: { title: true, category: { select: { name: true } }, project: { select: { name: true } } } } },
    }),
    prisma.habitCheckIn.findMany({
      where: { habit: { userId, deletedAt: null }, date: { gte: from, lte: to } },
      include: { habit: { select: { id: true, title: true } } },
    }),
    prisma.dailyNote.findMany({
      where: { userId, deletedAt: null, day: { gte: dayKeyIso(from), lte: dayKeyIso(to) } },
      orderBy: [{ day: "asc" }, { createdAt: "asc" }],
      select: { id: true, day: true, content: true, createdAt: true },
    }),
    prisma.project.findMany({
      where: { userId, deletedAt: null, OR: [{ createdAt: { gte: from, lte: to } }, { completedAt: { gte: from, lte: to } }] },
      select: { id: true, name: true, createdAt: true, completedAt: true },
    }),
    findEarliestDay(userId),
  ]);

  // Events: expand the recurring ones over the range, and note which occurrences were ticked as done.
  const completions = events.length
    ? await prisma.eventCompletion.findMany({ where: { eventId: { in: events.map((e) => e.id) }, occurrenceDate: { gte: from, lte: to } } })
    : [];
  const done = new Set(completions.map((c) => `${c.eventId}|${c.occurrenceDate.getTime()}`));
  const eventRows: JourneyEventRow[] = events.flatMap((event) =>
    expandOccurrences(event, from, to).map((occurrence) => ({
      id: occurrence.occurrenceId,
      title: event.title,
      startAt: occurrence.startAt.toISOString(),
      endAt: occurrence.endAt.toISOString(),
      allDay: event.allDay,
      location: event.location,
      project: event.project?.name ?? null,
      category: event.category?.name ?? null,
      done: done.has(`${event.id}|${occurrence.startAt.getTime()}`),
    }))
  );

  const taskRows: JourneyTaskRow[] = tasks.map((task) => {
    const at = task.startAt ?? task.completedAt ?? task.dueDate ?? task.createdAt;
    return {
      id: task.id,
      title: task.title,
      at: at.toISOString(),
      minutes: task.startAt && task.endAt ? minutesBetween(task.startAt, task.endAt) : null,
      project: task.project?.name ?? null,
      category: task.category?.name ?? null,
    };
  });

  const workRows: JourneyWorkRow[] = timeEntries.map((entry) => ({
    id: entry.id,
    title: entry.activity.title,
    startAt: entry.startAt.toISOString(),
    minutes: entry.durationMin ?? 0,
    project: entry.activity.project?.name ?? null,
    category: entry.activity.category?.name ?? null,
  }));

  // A streak needs each habit's whole history up to the end of the range, not just the days inside it.
  const habitIds = [...new Set(checkIns.map((c) => c.habitId))];
  const history = habitIds.length ? await prisma.habitCheckIn.findMany({ where: { habitId: { in: habitIds }, date: { lte: to } }, select: { habitId: true, date: true } }) : [];
  const daysByHabit = new Map<string, string[]>();
  for (const h of history) daysByHabit.set(h.habitId, [...(daysByHabit.get(h.habitId) ?? []), dayKeyIso(h.date)]);
  const streaks = new Map<string, Map<string, number>>();
  for (const [habitId, days] of daysByHabit) streaks.set(habitId, streakByDay(days));

  const habitRows: JourneyHabitRow[] = checkIns.map((c) => ({
    id: c.id,
    habitId: c.habitId,
    title: c.habit.title,
    date: c.date.toISOString(),
    at: c.createdAt.toISOString(),
    minutes: c.durationMin,
    streak: streaks.get(c.habitId)?.get(dayKeyIso(c.date)) ?? 1,
  }));

  const noteRows: JourneyNoteRow[] = notes.map((n) => ({ id: n.id, day: n.day, text: n.content, createdAt: n.createdAt.toISOString() }));

  const milestones: JourneyMilestoneRow[] = [];
  for (const p of projects) {
    if (p.createdAt >= from && p.createdAt <= to) milestones.push({ id: `${p.id}:start`, kind: "STARTED", name: p.name, at: p.createdAt.toISOString() });
    if (p.completedAt && p.completedAt >= from && p.completedAt <= to) milestones.push({ id: `${p.id}:end`, kind: "COMPLETED", name: p.name, at: p.completedAt.toISOString() });
  }

  return { events: eventRows, tasks: taskRows, work: workRows, habits: habitRows, notes: noteRows, milestones, earliestDay };
}
