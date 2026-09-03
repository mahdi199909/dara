// On-device mirror of src/lib/insightsData.ts — see its own comment for why this stays separate
// from reportEngine.ts. Raw SQL for ShownInsight lives directly here rather than in
// src/local/repositories/**, matching how CapitalSnapshot's own read/write lives in
// reportEngine.ts's recordDailyCapitalSnapshot: this isn't a CRUD resource, it's bookkeeping for
// one computed daily pick.
import { computeHourlyValue } from "@/lib/hourlyValue";
import { jalaliDateKey } from "@/lib/jalali";
import { selectDailyInsight, onThisDay, personalRecord, milestoneHours, type InsightContext, type DailyMinutes, type Insight } from "@/lib/insights";
import type { LocalDb } from "./db";
import {
  computeTimeAndMoneyReport,
  computeHiddenCostReport,
  computeFounderCapital,
  computeCategoryCalendar,
  sumCategoryLifetimeMinutes,
  sumProjectLifetimeMinutes,
  fetchDayIntervals,
} from "./reportEngine";

const SHOWN_SUPPRESSION_DAYS = 30;

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

function exactDayWindowAgo(now: Date, monthsBack: number, yearsBack: number): { start: Date; end: Date } {
  const start = new Date(now.getFullYear() - yearsBack, now.getMonth() - monthsBack, now.getDate());
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999);
  return { start, end };
}

function buildDailyMinutes(categoryCalendar: { days: Record<string, number> }[]): DailyMinutes[] {
  const totals = new Map<string, number>();
  for (const cat of categoryCalendar) {
    for (const [date, minutes] of Object.entries(cat.days)) {
      totals.set(date, (totals.get(date) ?? 0) + minutes);
    }
  }
  return Array.from(totals.entries()).map(([date, minutes]) => ({ date, minutes }));
}

interface BuiltContext {
  ctx: InsightContext;
  dailyMinutes90d: DailyMinutes[];
  alreadyShownIds: Set<string>;
}

/** On-device mirror of src/lib/insightsData.ts's buildContext. */
function buildContext(db: LocalDb, userId: string): BuiltContext {
  const now = new Date();

  const settingsRow = db.get<{ wakeHour: number | null; sleepHour: number | null; monthlyIncome: number | null; workingHoursMonth: number | null; hourlyValueOverride: number | null }>(
    `SELECT * FROM "Settings" WHERE "userId" = ?`,
    [userId]
  );
  const capital = computeFounderCapital(db, userId);
  const report7d = computeTimeAndMoneyReport(db, userId, daysAgo(now, 7), now);
  const report30d = computeTimeAndMoneyReport(db, userId, daysAgo(now, 30), now);
  const report90d = computeTimeAndMoneyReport(db, userId, daysAgo(now, 90), now);
  const reportPrevious30d = computeTimeAndMoneyReport(db, userId, daysAgo(now, 60), daysAgo(now, 30));
  const hiddenCost7d = computeHiddenCostReport(db, userId, daysAgo(now, 7), now);
  const categoryCalendar90d = computeCategoryCalendar(db, userId, daysAgo(now, 90), now);

  const lastMonth = exactDayWindowAgo(now, 1, 0);
  const lastYear = exactDayWindowAgo(now, 0, 1);
  const onThisDayLastMonth = computeTimeAndMoneyReport(db, userId, lastMonth.start, lastMonth.end);
  const onThisDayLastYear = computeTimeAndMoneyReport(db, userId, lastYear.start, lastYear.end);

  const categoryLifetimeMinutes = Object.fromEntries(report30d.timeByCategory.map((c) => [c.categoryId, sumCategoryLifetimeMinutes(db, userId, c.categoryId)]));
  const projectLifetimeMinutes = Object.fromEntries(report30d.timeByProject.map((p) => [p.projectId, sumProjectLifetimeMinutes(db, userId, p.projectId)]));

  const wakeHour = settingsRow?.wakeHour ?? 7;
  const sleepHour = settingsRow?.sleepHour ?? 23;
  const weekDaySegments = Array.from({ length: 7 }, (_, i) => i).map((i) => {
    const day = daysAgo(now, i);
    const wakeTime = new Date(day.getFullYear(), day.getMonth(), day.getDate(), wakeHour, 0, 0, 0);
    const sleepTime = new Date(day.getFullYear(), day.getMonth(), day.getDate(), sleepHour, 0, 0, 0);
    return { date: jalaliDateKey(day), wakeTime, sleepTime, intervals: fetchDayIntervals(db, userId, wakeTime, sleepTime) };
  });

  const capitalSnapshotRows = db.all<{ date: string; investedMinutes: number }>(`SELECT "date","investedMinutes" FROM "CapitalSnapshot" WHERE "userId" = ? ORDER BY "date" ASC`, [userId]);

  const ctx: InsightContext = {
    now,
    dataDays: capital.firstRecordAt ? Math.floor((now.getTime() - capital.firstRecordAt.getTime()) / 86_400_000) : 0,
    report7d,
    report30d,
    report90d,
    reportPrevious30d,
    hiddenCost7d,
    onThisDayLastMonth,
    onThisDayLastYear,
    categoryLifetimeMinutes,
    projectLifetimeMinutes,
    capitalSnapshots: capitalSnapshotRows,
    weekDaySegments,
    hourlyValue: computeHourlyValue(settingsRow ?? {}),
  };

  // See src/lib/insightsData.ts's identical comment: upper-bounded at today's own start so a
  // same-day re-call doesn't exclude its own just-recorded pick.
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sinceIso = daysAgo(now, SHOWN_SUPPRESSION_DAYS).toISOString();
  const shownRows = db.all<{ insightId: string }>(
    `SELECT "insightId" FROM "ShownInsight" WHERE "userId" = ? AND "shownAt" >= ? AND "shownAt" < ?`,
    [userId, sinceIso, startOfToday.toISOString()]
  );

  return { ctx, dailyMinutes90d: buildDailyMinutes(categoryCalendar90d), alreadyShownIds: new Set(shownRows.map((r) => r.insightId)) };
}

function recordShown(db: LocalDb, userId: string, insight: Insight, now: Date): void {
  db.run(
    `INSERT INTO "ShownInsight" ("id","userId","insightId","shownAt") VALUES (?,?,?,?)
     ON CONFLICT("userId","insightId") DO UPDATE SET "shownAt" = excluded."shownAt"`,
    [crypto.randomUUID(), userId, insight.id, now.toISOString()]
  );
}

export function computeDailyInsight(db: LocalDb, userId: string): Insight | null {
  const { ctx, dailyMinutes90d, alreadyShownIds } = buildContext(db, userId);
  const insight = selectDailyInsight(ctx, dailyMinutes90d, userId, alreadyShownIds);
  if (insight) recordShown(db, userId, insight, ctx.now);
  return insight;
}

export interface DailyMomentCandidates {
  discovery: Insight | null;
  onThisDay: Insight | null;
  milestone: Insight | null;
}

/** On-device mirror of src/lib/insightsData.ts's computeDailyMomentCandidates — see its doc
 * comment for why all three non-null candidates get recorded as shown immediately. */
export function computeDailyMomentCandidates(db: LocalDb, userId: string): DailyMomentCandidates {
  const { ctx, dailyMinutes90d, alreadyShownIds } = buildContext(db, userId);

  const discovery = selectDailyInsight(ctx, dailyMinutes90d, userId, alreadyShownIds);
  const onThisDayRaw = onThisDay(ctx);
  const onThisDayPick = onThisDayRaw && !alreadyShownIds.has(onThisDayRaw.id) ? onThisDayRaw : null;
  const milestoneRaw = personalRecord(ctx) ?? milestoneHours(ctx);
  const milestonePick = milestoneRaw && !alreadyShownIds.has(milestoneRaw.id) ? milestoneRaw : null;

  for (const insight of [discovery, onThisDayPick, milestonePick]) {
    if (insight) recordShown(db, userId, insight, ctx.now);
  }

  return { discovery, onThisDay: onThisDayPick, milestone: milestonePick };
}
