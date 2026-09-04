// Assembles InsightContext from real data and calls the pure engine (src/lib/insights.ts). Kept
// separate from reportEngine.ts (already large after Phase 12's additions) rather than folded in
// — this is its own concern: one daily pick plus the ShownInsight dedup bookkeeping, not a report.
import { prisma } from "./db";
import { computeHourlyValue } from "./hourlyValue";
import { jalaliDateKey } from "./jalali";
import {
  computeTimeAndMoneyReport,
  computeHiddenCostReport,
  computeFounderCapital,
  computeCategoryCalendar,
  sumCategoryLifetimeMinutes,
  sumProjectLifetimeMinutes,
  fetchDayIntervals,
} from "./reportEngine";
import { selectDailyInsight, onThisDay, personalRecord, milestoneHours, type InsightContext, type DailyMinutes, type Insight } from "./insights";

const SHOWN_SUPPRESSION_DAYS = 30;

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

/** The exact same calendar day, N months/years back, as a full [start, end] day window — for
 * onThisDay. A date that predates the account (or the calendar itself, e.g. Feb 30) just comes
 * back with no data, which the detector already treats as "no memory to surface". */
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
  /** Already excludes anything recorded earlier TODAY (see the comment at its computation) —
   * both computeDailyInsight and computeDailyMomentCandidates share this exact set. */
  alreadyShownIds: Set<string>;
}

/** Everything both computeDailyInsight and computeDailyMomentCandidates need — factored out so
 * the (expensive, many-query) context assembly happens exactly once per exported function, not
 * once per caller of this module. */
async function buildContext(userId: string): Promise<BuiltContext> {
  const now = new Date();

  const [settings, capital, report7d, report30d, report90d, reportPrevious30d, hiddenCost7d, categoryCalendar90d] = await Promise.all([
    prisma.settings.findUnique({ where: { userId } }),
    computeFounderCapital(userId),
    computeTimeAndMoneyReport(userId, daysAgo(now, 7), now),
    computeTimeAndMoneyReport(userId, daysAgo(now, 30), now),
    computeTimeAndMoneyReport(userId, daysAgo(now, 90), now),
    computeTimeAndMoneyReport(userId, daysAgo(now, 60), daysAgo(now, 30)),
    computeHiddenCostReport(userId, daysAgo(now, 7), now),
    computeCategoryCalendar(userId, daysAgo(now, 90), now),
  ]);

  const lastMonth = exactDayWindowAgo(now, 1, 0);
  const lastYear = exactDayWindowAgo(now, 0, 1);
  const [onThisDayLastMonth, onThisDayLastYear] = await Promise.all([
    computeTimeAndMoneyReport(userId, lastMonth.start, lastMonth.end),
    computeTimeAndMoneyReport(userId, lastYear.start, lastYear.end),
  ]);

  const [categoryLifetimeEntries, projectLifetimeEntries] = await Promise.all([
    Promise.all(report30d.timeByCategory.map(async (c) => [c.categoryId, await sumCategoryLifetimeMinutes(userId, c.categoryId)] as const)),
    Promise.all(report30d.timeByProject.map(async (p) => [p.projectId, await sumProjectLifetimeMinutes(userId, p.projectId)] as const)),
  ]);

  const wakeHour = settings?.wakeHour ?? 7;
  const sleepHour = settings?.sleepHour ?? 23;
  const weekDaySegments = await Promise.all(
    Array.from({ length: 7 }, (_, i) => i).map(async (i) => {
      const day = daysAgo(now, i);
      const wakeTime = new Date(day.getFullYear(), day.getMonth(), day.getDate(), wakeHour, 0, 0, 0);
      const sleepTime = new Date(day.getFullYear(), day.getMonth(), day.getDate(), sleepHour, 0, 0, 0);
      const intervals = await fetchDayIntervals(userId, wakeTime, sleepTime);
      return { date: jalaliDateKey(day), wakeTime, sleepTime, intervals };
    })
  );

  const capitalSnapshotRows = await prisma.capitalSnapshot.findMany({ where: { userId }, orderBy: { date: "asc" } });

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
    categoryLifetimeMinutes: Object.fromEntries(categoryLifetimeEntries),
    projectLifetimeMinutes: Object.fromEntries(projectLifetimeEntries),
    capitalSnapshots: capitalSnapshotRows.map((s) => ({ date: s.date, investedMinutes: s.investedMinutes })),
    weekDaySegments,
    hourlyValue: computeHourlyValue(settings ?? {}),
  };

  // Upper-bounded at today's own start: a pick already recorded earlier TODAY must stay
  // excluded from "already shown" or a same-day re-call (a page refresh) would exclude its own
  // just-recorded pick and select something else — breaking "same pick all day" determinism.
  // Only picks from an *earlier* day count toward the 30-day suppression.
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const shownRows = await prisma.shownInsight.findMany({
    where: { userId, shownAt: { gte: daysAgo(now, SHOWN_SUPPRESSION_DAYS), lt: startOfToday } },
    select: { insightId: true },
  });

  return { ctx, dailyMinutes90d: buildDailyMinutes(categoryCalendar90d), alreadyShownIds: new Set(shownRows.map((r) => r.insightId)) };
}

async function recordShown(userId: string, insight: Insight, now: Date): Promise<void> {
  await prisma.shownInsight.upsert({
    where: { userId_insightId: { userId, insightId: insight.id } },
    create: { userId, insightId: insight.id, shownAt: now },
    update: { shownAt: now },
  });
}

/**
 * Today's insight pick for `userId`, or null if nothing clears the honesty gate or everything
 * eligible was already shown in the last 30 days. Recording which insight was shown (so it isn't
 * repeated) happens here too, right after selection — the one side effect this wrapper has.
 */
export async function computeDailyInsight(userId: string): Promise<Insight | null> {
  const { ctx, dailyMinutes90d, alreadyShownIds } = await buildContext(userId);
  const insight = selectDailyInsight(ctx, dailyMinutes90d, userId, alreadyShownIds);
  if (insight) await recordShown(userId, insight, ctx.now);
  return insight;
}

export interface DailyMomentCandidates {
  discovery: Insight | null;
  onThisDay: Insight | null;
  milestone: Insight | null;
}

/**
 * The three insight-engine-sourced candidates for DailyMomentCard's "discovery" / "onThisDay" /
 * "milestone" types (its "quote" type is a separate, pre-existing, client-side data source — see
 * fetchDailyQuote — with no context in common with this module). All three non-null candidates
 * get recorded as shown immediately, even though only one of the 4 types will actually be
 * displayed once src/lib/dailyMoment.ts's weighted pick runs client-side: the alternative (a
 * second round-trip to mark only the winner as shown) needs its own stateful call this pass
 * doesn't add, and a milestone/record candidate specifically MUST be marked shown regardless —
 * without it, a 30-day-rolling "before < threshold" window would otherwise report the same
 * crossing as freshly-happened on every call for weeks.
 */
export async function computeDailyMomentCandidates(userId: string): Promise<DailyMomentCandidates> {
  const { ctx, dailyMinutes90d, alreadyShownIds } = await buildContext(userId);

  const discovery = selectDailyInsight(ctx, dailyMinutes90d, userId, alreadyShownIds);
  const onThisDayRaw = onThisDay(ctx);
  const onThisDayPick = onThisDayRaw && !alreadyShownIds.has(onThisDayRaw.id) ? onThisDayRaw : null;
  const milestoneRaw = personalRecord(ctx) ?? milestoneHours(ctx);
  const milestonePick = milestoneRaw && !alreadyShownIds.has(milestoneRaw.id) ? milestoneRaw : null;

  await Promise.all([discovery, onThisDayPick, milestonePick].filter((i): i is Insight => i !== null).map((i) => recordShown(userId, i, ctx.now)));

  return { discovery, onThisDay: onThisDayPick, milestone: milestonePick };
}
