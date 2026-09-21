// On-device port of src/lib/searchData.ts — the same three steps against the phone's SQLite: read light
// candidates, let the shared engine (src/lib/searchEngine.ts) choose the ones that match, load the full
// rows of just those, and let the engine build the results.
import { computeHourlyValue } from "@/lib/hourlyValue";
import { buildSearchResults, pickCandidateIds, type SearchCandidates, type SearchResult, type SearchRows } from "@/lib/searchEngine";
import type { LocalDb } from "../db";

export type { SearchResult };

const CANDIDATE_CAP = 5000;

const minutesBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
const marks = (ids: unknown[]) => ids.map(() => "?").join(",");

/** Rows in the order of `ids` (which is the order of relevance). */
function inOrder<T extends { id: string }>(ids: string[], rows: T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is T => !!r);
}

/** Folds the category columns a LEFT JOIN added back into a nested `category`. */
function withCategory(row: any): any {
  const { categoryName, categoryIcon, ...rest } = row;
  return { ...rest, category: categoryName ? { name: categoryName, icon: categoryIcon } : null };
}

export function search(db: LocalDb, userId: string, q: string | undefined): SearchResult[] {
  const query = q?.trim().slice(0, 100);
  if (!query) return [];

  const tasks = db.all<{ id: string; title: string; description: string | null; startAt: string | null; dueDate: string | null; createdAt: string }>(
    `SELECT "id","title","description","startAt","dueDate","createdAt" FROM "Task" WHERE "userId" = ? AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT ${CANDIDATE_CAP}`,
    [userId]
  );
  const events = db.all<{ id: string; title: string; description: string | null; location: string | null; startAt: string }>(
    `SELECT "id","title","description","location","startAt" FROM "Event" WHERE "userId" = ? AND "deletedAt" IS NULL AND "recurrenceParentId" IS NULL ORDER BY "startAt" DESC LIMIT ${CANDIDATE_CAP}`,
    [userId]
  );
  const activities = db.all<{ id: string; title: string; notes: string | null; createdAt: string }>(
    `SELECT "id","title","notes","createdAt" FROM "Activity" WHERE "userId" = ? AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT ${CANDIDATE_CAP}`,
    [userId]
  );
  const notes = db.all<{ id: string; day: string; content: string }>(
    `SELECT "id","day","content" FROM "DailyNote" WHERE "userId" = ? AND "deletedAt" IS NULL LIMIT ${CANDIDATE_CAP}`,
    [userId]
  );
  // A transaction that a task's or event's own cost created is that task or event — listing it too would show one thing twice.
  const transactions = db.all<{ id: string; description: string; date: string }>(
    `SELECT "id","description","date" FROM "Transaction"
     WHERE "userId" = ? AND "deletedAt" IS NULL AND "description" IS NOT NULL AND "taskId" IS NULL AND "eventId" IS NULL
     ORDER BY "date" DESC LIMIT ${CANDIDATE_CAP}`,
    [userId]
  );
  const habits = db.all<{ id: string; title: string }>(`SELECT "id","title" FROM "Habit" WHERE "userId" = ? AND "deletedAt" IS NULL`, [userId]);
  const categories = db.all<{ id: string; name: string }>(`SELECT "id","name" FROM "Category" WHERE "userId" = ? AND "deletedAt" IS NULL`, [userId]);
  const plans = db.all<{ id: string; title: string; notes: string | null }>(`SELECT "id","title","notes" FROM "InstallmentPlan" WHERE "userId" = ? AND "deletedAt" IS NULL`, [userId]);
  const projects = db.all<{ id: string; name: string }>(`SELECT "id","name" FROM "Project" WHERE "userId" = ? AND "deletedAt" IS NULL`, [userId]);
  const assets = db.all<{ id: string; name: string }>(`SELECT "id","name" FROM "Asset" WHERE "userId" = ? AND "deletedAt" IS NULL`, [userId]);

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
  if (!Object.values(ids).some((list) => list.length > 0)) return [];

  const taskRows = ids.tasks.length
    ? db
        .all<any>(
          `SELECT t."id", t."title", t."status", t."dueDate", t."startAt", t."endAt", t."createdAt", t."directCost", t."incomeAmount",
                  c."id" as "categoryId", c."name" as "categoryName", c."icon" as "categoryIcon"
           FROM "Task" t LEFT JOIN "Category" c ON c."id" = t."categoryId"
           WHERE t."userId" = ? AND t."id" IN (${marks(ids.tasks)})`,
          [userId, ...ids.tasks]
        )
        .map(withCategory)
    : [];
  const eventRows = ids.events.length
    ? db
        .all<any>(
          `SELECT e."id", e."title", e."allDay", e."startAt", e."endAt", e."recurrenceFreq", e."directCost", e."incomeAmount",
                  c."id" as "categoryId", c."name" as "categoryName", c."icon" as "categoryIcon"
           FROM "Event" e LEFT JOIN "Category" c ON c."id" = e."categoryId"
           WHERE e."userId" = ? AND e."id" IN (${marks(ids.events)})`,
          [userId, ...ids.events]
        )
        .map(withCategory)
    : [];
  const activityRows = ids.activities.length
    ? db
        .all<any>(
          `SELECT a."id", a."title", a."totalDurationMin", a."directCost", c."id" as "categoryId", c."name" as "categoryName", c."icon" as "categoryIcon"
           FROM "Activity" a LEFT JOIN "Category" c ON c."id" = a."categoryId"
           WHERE a."userId" = ? AND a."id" IN (${marks(ids.activities)})`,
          [userId, ...ids.activities]
        )
        .map(withCategory)
    : [];
  const activityEntries = ids.activities.length
    ? db.all<{ activityId: string; startAt: string; durationMin: number }>(
        `SELECT "activityId","startAt","durationMin" FROM "TimeEntry" WHERE "activityId" IN (${marks(ids.activities)}) AND "durationMin" IS NOT NULL`,
        ids.activities
      )
    : [];
  const completions = ids.events.length
    ? db.all<{ eventId: string; occurrenceDate: string }>(`SELECT "eventId","occurrenceDate" FROM "EventCompletion" WHERE "eventId" IN (${marks(ids.events)})`, ids.events)
    : [];
  const transactionRows = ids.transactions.length
    ? db
        .all<any>(
          `SELECT t."id", t."type", t."amount", t."date", t."description", c."id" as "categoryId", c."name" as "categoryName", c."icon" as "categoryIcon"
           FROM "Transaction" t LEFT JOIN "Category" c ON c."id" = t."categoryId"
           WHERE t."userId" = ? AND t."id" IN (${marks(ids.transactions)})`,
          [userId, ...ids.transactions]
        )
        .map(withCategory)
    : [];
  const habitRows = ids.habits.length
    ? db
        .all<any>(
          `SELECT h."id", h."title", h."icon", h."categoryId" as "categoryId", c."name" as "categoryName", c."icon" as "categoryIcon"
           FROM "Habit" h LEFT JOIN "Category" c ON c."id" = h."categoryId"
           WHERE h."userId" = ? AND h."id" IN (${marks(ids.habits)})`,
          [userId, ...ids.habits]
        )
        .map(withCategory)
    : [];
  const habitCheckIns = ids.habits.length
    ? db.all<{ habitId: string; date: string; durationMin: number | null }>(`SELECT "habitId","date","durationMin" FROM "HabitCheckIn" WHERE "habitId" IN (${marks(ids.habits)})`, ids.habits)
    : [];
  const categoryRows = ids.categories.length
    ? db.all<{ id: string; name: string; icon: string | null }>(`SELECT "id","name","icon" FROM "Category" WHERE "userId" = ? AND "id" IN (${marks(ids.categories)})`, [userId, ...ids.categories])
    : [];
  const planRows = ids.plans.length
    ? db.all<{ id: string; title: string }>(`SELECT "id","title" FROM "InstallmentPlan" WHERE "userId" = ? AND "id" IN (${marks(ids.plans)})`, [userId, ...ids.plans]).map((p) => ({
        ...p,
        installments: db.all<{ amount: number; status: string; dueDate: string }>(`SELECT "amount","status","dueDate" FROM "Installment" WHERE "planId" = ?`, [p.id]),
      }))
    : [];

  const categoryLogs: SearchRows["categoryLogs"] = [];
  if (ids.categories.length) {
    const inCategories = marks(ids.categories);
    for (const t of db.all<{ categoryId: string; startAt: string; endAt: string }>(
      `SELECT "categoryId","startAt","endAt" FROM "Task"
       WHERE "userId" = ? AND "deletedAt" IS NULL AND "categoryId" IN (${inCategories}) AND "startAt" IS NOT NULL AND "endAt" IS NOT NULL`,
      [userId, ...ids.categories]
    )) {
      categoryLogs.push({ categoryId: t.categoryId, date: t.startAt, minutes: minutesBetween(t.startAt, t.endAt) });
    }
    for (const c of db.all<{ categoryId: string; occurrenceDate: string; startAt: string; endAt: string }>(
      `SELECT e."categoryId" as "categoryId", ec."occurrenceDate" as "occurrenceDate", e."startAt" as "startAt", e."endAt" as "endAt"
       FROM "EventCompletion" ec JOIN "Event" e ON e."id" = ec."eventId"
       WHERE e."userId" = ? AND e."deletedAt" IS NULL AND e."allDay" = 0 AND e."categoryId" IN (${inCategories})`,
      [userId, ...ids.categories]
    )) {
      categoryLogs.push({ categoryId: c.categoryId, date: c.occurrenceDate, minutes: minutesBetween(c.startAt, c.endAt) });
    }
    for (const t of db.all<{ categoryId: string; startAt: string; durationMin: number }>(
      `SELECT a."categoryId" as "categoryId", te."startAt" as "startAt", te."durationMin" as "durationMin"
       FROM "TimeEntry" te JOIN "Activity" a ON a."id" = te."activityId"
       WHERE a."userId" = ? AND a."deletedAt" IS NULL AND a."categoryId" IN (${inCategories}) AND te."durationMin" IS NOT NULL`,
      [userId, ...ids.categories]
    )) {
      categoryLogs.push({ categoryId: t.categoryId, date: t.startAt, minutes: t.durationMin });
    }
    for (const c of db.all<{ categoryId: string; date: string; durationMin: number }>(
      `SELECT h."categoryId" as "categoryId", hc."date" as "date", hc."durationMin" as "durationMin"
       FROM "HabitCheckIn" hc JOIN "Habit" h ON h."id" = hc."habitId"
       WHERE h."userId" = ? AND h."deletedAt" IS NULL AND h."categoryId" IN (${inCategories}) AND hc."durationMin" IS NOT NULL`,
      [userId, ...ids.categories]
    )) {
      categoryLogs.push({ categoryId: c.categoryId, date: c.date, minutes: c.durationMin });
    }
  }

  const settingsRow = db.get<any>(`SELECT * FROM "Settings" WHERE "userId" = ?`, [userId]);
  const doneKeys = new Set(completions.map((c) => `${c.eventId}|${new Date(c.occurrenceDate).getTime()}`));

  const rows: SearchRows = {
    tasks: inOrder(ids.tasks, taskRows),
    events: inOrder(ids.events, eventRows).map((e: any) => ({ ...e, allDay: !!e.allDay, isDone: doneKeys.has(`${e.id}|${new Date(e.startAt).getTime()}`) })),
    activities: inOrder(ids.activities, activityRows),
    notes: ids.notes.map((id) => notes.find((n) => n.id === id)!).filter(Boolean),
    transactions: inOrder(ids.transactions, transactionRows),
    habits: inOrder(ids.habits, habitRows),
    categories: inOrder(ids.categories, categoryRows),
    plans: inOrder(ids.plans, planRows),
    projects: ids.projects.map((id) => projects.find((p) => p.id === id)!).filter(Boolean),
    assets: ids.assets.map((id) => assets.find((a) => a.id === id)!).filter(Boolean),
    activityEntries: activityEntries.map((e) => ({ activityId: e.activityId, date: e.startAt, minutes: e.durationMin })),
    habitCheckIns,
    categoryLogs,
    hourlyValue: computeHourlyValue(settingsRow ?? {}),
  };

  return buildSearchResults(query, rows);
}
