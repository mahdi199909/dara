// On-device port of src/app/api/dashboard/route.ts — composes the already-ported report
// engine with a few direct queries + the pure recurrence/installments helpers.
import { toJalali, jalaliMonthRange } from "@/lib/jalali";
import { summarizeInstallments } from "@/lib/installments";
import { expandOccurrences } from "@/lib/recurrence";
import type { LocalDb } from "../db";
import { fetchByIds } from "../relations";
import { computeTimeAndMoneyReport, computeNetWorth } from "../reportEngine";

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function getDashboard(db: LocalDb, userId: string) {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const { jy, jm } = toJalali(now);
  const { start: monthStart, end: monthEnd } = jalaliMonthRange(jy, jm);

  const todayReport = computeTimeAndMoneyReport(db, userId, todayStart, todayEnd);
  const monthReport = computeTimeAndMoneyReport(db, userId, monthStart, monthEnd);
  const netWorth = computeNetWorth(db, userId);

  const tasksToday = db.all<any>(
    `SELECT * FROM "Task" WHERE "userId" = ? AND "deletedAt" IS NULL
       AND (("dueDate" >= ? AND "dueDate" <= ?) OR ("status" != 'DONE' AND "dueDate" IS NULL))
     ORDER BY "createdAt" DESC LIMIT 8`,
    [userId, todayStart.toISOString(), todayEnd.toISOString()]
  );
  const taskCategoryById = fetchByIds<any>(db, "Category", tasksToday.map((t) => t.categoryId));
  const taskProjectById = fetchByIds<any>(db, "Project", tasksToday.map((t) => t.projectId));
  const tasksTodayWithRelations = tasksToday.map((t) => ({
    ...t,
    category: t.categoryId ? taskCategoryById.get(t.categoryId) ?? null : null,
    project: t.projectId ? taskProjectById.get(t.projectId) ?? null : null,
  }));

  const plans = db.all<any>(`SELECT * FROM "InstallmentPlan" WHERE "userId" = ? AND "deletedAt" IS NULL`, [userId]);
  const monthInstallmentsRaw = plans.flatMap((p) => {
    const installments = db.all<any>(`SELECT * FROM "Installment" WHERE "planId" = ? AND "dueDate" >= ? AND "dueDate" <= ?`, [p.id, monthStart.toISOString(), monthEnd.toISOString()]);
    return installments.map((i) => ({ ...i, planTitle: p.title }));
  });
  const installmentSummary = summarizeInstallments(monthInstallmentsRaw.map((i) => ({ ...i, dueDate: new Date(i.dueDate) })));

  const recentActivities = db.all<any>(`SELECT * FROM "Activity" WHERE "userId" = ? AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 5`, [userId]);
  const activityCategoryById = fetchByIds<any>(db, "Category", recentActivities.map((a) => a.categoryId));
  const recentActivitiesWithRelations = recentActivities.map((a) => ({
    ...a,
    category: a.categoryId ? activityCategoryById.get(a.categoryId) ?? null : null,
    timeEntries: db.all<any>(`SELECT * FROM "TimeEntry" WHERE "activityId" = ?`, [a.id]),
  }));

  const allEventRows = db.all<any>(`SELECT * FROM "Event" WHERE "userId" = ? AND "deletedAt" IS NULL AND "recurrenceParentId" IS NULL`, [userId]);
  const eventCategoryById = fetchByIds<any>(db, "Category", allEventRows.map((e) => e.categoryId));
  const allEvents = allEventRows.map((e) => ({
    ...e,
    startAt: new Date(e.startAt),
    endAt: new Date(e.endAt),
    recurrenceUntil: e.recurrenceUntil ? new Date(e.recurrenceUntil) : null,
    category: e.categoryId ? eventCategoryById.get(e.categoryId) ?? null : null,
  }));

  const eventsToday = allEvents
    .flatMap((e) => expandOccurrences(e as any, todayStart, todayEnd).map((occ) => ({ ...occ, event: e })))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const upcomingWindowEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const upcomingEvents = allEvents
    .flatMap((e) => expandOccurrences(e as any, now, upcomingWindowEnd).map((occ) => ({ ...occ, event: e })))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .slice(0, 5);

  const categories = db.all<any>(`SELECT * FROM "Category" WHERE "userId" = ? AND "deletedAt" IS NULL`, [userId]);

  const runningTimeEntry = db.get<any>(
    `SELECT te.* FROM "TimeEntry" te JOIN "Activity" a ON a."id" = te."activityId" WHERE a."userId" = ? AND a."deletedAt" IS NULL AND te."isRunning" = 1 LIMIT 1`,
    [userId]
  );
  const activeRunningTimer = runningTimeEntry
    ? { ...runningTimeEntry, activity: db.get<any>(`SELECT * FROM "Activity" WHERE "id" = ?`, [runningTimeEntry.activityId]) }
    : null;

  return {
    today: todayReport,
    month: monthReport,
    netWorth,
    tasksToday: tasksTodayWithRelations,
    eventsToday,
    upcomingEvents,
    monthInstallments: installmentSummary,
    recentActivities: recentActivitiesWithRelations,
    activeRunningTimer,
    categories,
  };
}
