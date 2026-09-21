// The server's side of the search: read light candidates (Prisma), let the shared engine choose the
// ones that match, load the full rows of just those, and let the engine build what the screen shows.
// The phone does the same from its own SQLite in src/local/repositories/search.ts.
import { prisma } from "@/lib/db";
import { computeHourlyValue } from "@/lib/hourlyValue";
import { buildSearchResults, pickCandidateIds, type SearchCandidates, type SearchResult, type SearchRows } from "@/lib/searchEngine";

// A person's own history — thousands of rows at the very most. Comparing normalized text in memory over
// this many light rows is cheap, and it is what lets «میخوانم» find «می‌خوانم» (a database LIKE cannot).
const CANDIDATE_CAP = 5000;

const minutesBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));

/** Rows in the order of `ids` (which is the order of relevance). */
function inOrder<T extends { id: string }>(ids: string[], rows: T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is T => !!r);
}

export async function searchAll(userId: string, query: string): Promise<SearchResult[]> {
  const [tasks, events, activities, notes, transactions, habits, categories, plans, projects, assets] = await Promise.all([
    prisma.task.findMany({
      where: { userId, deletedAt: null },
      select: { id: true, title: true, description: true, startAt: true, dueDate: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: CANDIDATE_CAP,
    }),
    prisma.event.findMany({
      where: { userId, deletedAt: null, recurrenceParentId: null },
      select: { id: true, title: true, description: true, location: true, startAt: true },
      orderBy: { startAt: "desc" },
      take: CANDIDATE_CAP,
    }),
    prisma.activity.findMany({ where: { userId, deletedAt: null }, select: { id: true, title: true, notes: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: CANDIDATE_CAP }),
    prisma.dailyNote.findMany({ where: { userId, deletedAt: null }, select: { id: true, day: true, content: true }, take: CANDIDATE_CAP }),
    // A transaction that a task's or event's own cost created is that task or event — listing it too would show one thing twice.
    prisma.transaction.findMany({
      where: { userId, deletedAt: null, description: { not: null }, taskId: null, eventId: null },
      select: { id: true, description: true, date: true },
      orderBy: { date: "desc" },
      take: CANDIDATE_CAP,
    }),
    prisma.habit.findMany({ where: { userId, deletedAt: null }, select: { id: true, title: true } }),
    prisma.category.findMany({ where: { userId, deletedAt: null }, select: { id: true, name: true } }),
    prisma.installmentPlan.findMany({ where: { userId, deletedAt: null }, select: { id: true, title: true, notes: true } }),
    prisma.project.findMany({ where: { userId, deletedAt: null }, select: { id: true, name: true } }),
    prisma.asset.findMany({ where: { userId, deletedAt: null }, select: { id: true, name: true } }),
  ]);

  const candidates: SearchCandidates = {
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, description: t.description, sortAt: t.startAt ?? t.dueDate ?? t.createdAt })),
    events: events.map((e) => ({ id: e.id, title: e.title, description: e.description, location: e.location, sortAt: e.startAt })),
    activities: activities.map((a) => ({ id: a.id, title: a.title, notes: a.notes, sortAt: a.createdAt })),
    notes,
    transactions: transactions.map((t) => ({ id: t.id, description: t.description, sortAt: t.date })),
    habits,
    categories,
    plans,
    projects,
    assets,
  };
  const ids = pickCandidateIds(query, candidates);
  const anything = Object.values(ids).some((list) => list.length > 0);
  if (!anything) return [];

  const [taskRows, eventRows, activityRows, transactionRows, habitRows, categoryRows, planRows, settings] = await Promise.all([
    ids.tasks.length
      ? prisma.task.findMany({ where: { userId, id: { in: ids.tasks } }, include: { category: { select: { name: true, icon: true } } } })
      : [],
    ids.events.length
      ? prisma.event.findMany({ where: { userId, id: { in: ids.events } }, include: { category: { select: { name: true, icon: true } } } })
      : [],
    ids.activities.length
      ? prisma.activity.findMany({ where: { userId, id: { in: ids.activities } }, include: { category: { select: { name: true, icon: true } } } })
      : [],
    ids.transactions.length
      ? prisma.transaction.findMany({ where: { userId, id: { in: ids.transactions } }, include: { category: { select: { name: true, icon: true } } } })
      : [],
    ids.habits.length
      ? prisma.habit.findMany({ where: { userId, id: { in: ids.habits } }, select: { id: true, title: true, icon: true, categoryId: true, category: { select: { name: true, icon: true } } } })
      : [],
    ids.categories.length ? prisma.category.findMany({ where: { userId, id: { in: ids.categories } }, select: { id: true, name: true, icon: true } }) : [],
    ids.plans.length
      ? prisma.installmentPlan.findMany({ where: { userId, id: { in: ids.plans } }, include: { installments: { select: { amount: true, status: true, dueDate: true } } } })
      : [],
    prisma.settings.findUnique({ where: { userId } }),
  ]);

  const [completions, activityEntries, habitCheckIns, categoryTasks, categoryCompletions, categoryTimeEntries, categoryCheckIns] = await Promise.all([
    ids.events.length ? prisma.eventCompletion.findMany({ where: { eventId: { in: ids.events } }, select: { eventId: true, occurrenceDate: true } }) : [],
    ids.activities.length
      ? prisma.timeEntry.findMany({ where: { activityId: { in: ids.activities }, durationMin: { not: null } }, select: { activityId: true, startAt: true, durationMin: true } })
      : [],
    ids.habits.length ? prisma.habitCheckIn.findMany({ where: { habitId: { in: ids.habits } }, select: { habitId: true, date: true, durationMin: true } }) : [],
    ids.categories.length
      ? prisma.task.findMany({
          where: { userId, deletedAt: null, categoryId: { in: ids.categories }, startAt: { not: null }, endAt: { not: null } },
          select: { categoryId: true, startAt: true, endAt: true },
        })
      : [],
    ids.categories.length
      ? prisma.eventCompletion.findMany({
          where: { event: { userId, deletedAt: null, allDay: false, categoryId: { in: ids.categories } } },
          select: { occurrenceDate: true, event: { select: { categoryId: true, startAt: true, endAt: true } } },
        })
      : [],
    ids.categories.length
      ? prisma.timeEntry.findMany({
          where: { activity: { userId, deletedAt: null, categoryId: { in: ids.categories } }, durationMin: { not: null } },
          select: { startAt: true, durationMin: true, activity: { select: { categoryId: true } } },
        })
      : [],
    ids.categories.length
      ? prisma.habitCheckIn.findMany({
          where: { habit: { userId, deletedAt: null, categoryId: { in: ids.categories } }, durationMin: { not: null } },
          select: { date: true, durationMin: true, habit: { select: { categoryId: true } } },
        })
      : [],
  ]);

  const rows: SearchRows = {
    tasks: inOrder(ids.tasks, taskRows),
    events: inOrder(ids.events, eventRows).map((e) => ({
      ...e,
      isDone: completions.some((c) => c.eventId === e.id && c.occurrenceDate.getTime() === e.startAt.getTime()),
    })),
    activities: inOrder(ids.activities, activityRows),
    notes: ids.notes.map((id) => notes.find((n) => n.id === id)!).filter(Boolean),
    transactions: inOrder(ids.transactions, transactionRows),
    habits: inOrder(ids.habits, habitRows),
    categories: inOrder(ids.categories, categoryRows),
    plans: inOrder(ids.plans, planRows),
    projects: ids.projects.map((id) => projects.find((p) => p.id === id)!).filter(Boolean),
    assets: ids.assets.map((id) => assets.find((a) => a.id === id)!).filter(Boolean),
    activityEntries: activityEntries.map((e) => ({ activityId: e.activityId, date: e.startAt, minutes: e.durationMin ?? 0 })),
    habitCheckIns,
    categoryLogs: [
      ...categoryTasks.map((t) => ({ categoryId: t.categoryId!, date: t.startAt!, minutes: minutesBetween(t.startAt!, t.endAt!) })),
      ...categoryCompletions.map((c) => ({ categoryId: c.event.categoryId!, date: c.occurrenceDate, minutes: minutesBetween(c.event.startAt, c.event.endAt) })),
      ...categoryTimeEntries.map((t) => ({ categoryId: t.activity.categoryId!, date: t.startAt, minutes: t.durationMin ?? 0 })),
      ...categoryCheckIns.map((c) => ({ categoryId: c.habit.categoryId!, date: c.date, minutes: c.durationMin ?? 0 })),
    ],
    hourlyValue: computeHourlyValue(settings ?? {}),
  };

  return buildSearchResults(query, rows);
}
