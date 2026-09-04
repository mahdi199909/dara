// Assembles IdentityContext from real data and calls the pure engine (src/lib/identity.ts).
// Separate from reportEngine.ts for the same reason insightsData.ts is: its own concern (turning
// raw records into identity-shaped facts), not a report.
import { prisma } from "./db";
import { computeTimeAndMoneyReport, computeFounderCapital, fetchActiveDayKeys } from "./reportEngine";
import { buildIdentityStatements, type IdentityContext, type IdentityStatement } from "./identity";

const SKILL_WINDOW_DAYS = 30;
const WIDE_WINDOW_DAYS = 90;

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

async function buildContext(userId: string): Promise<IdentityContext> {
  const now = new Date();
  const projectWindowStart = daysAgo(now, WIDE_WINDOW_DAYS);

  const [capital, report30d, report90d, skillCategories, habits, completedProjectsCount, loggingActiveDayKeys] = await Promise.all([
    computeFounderCapital(userId),
    computeTimeAndMoneyReport(userId, daysAgo(now, SKILL_WINDOW_DAYS), now),
    computeTimeAndMoneyReport(userId, daysAgo(now, WIDE_WINDOW_DAYS), now),
    prisma.category.findMany({ where: { userId, generatesVirtualAsset: true }, select: { id: true } }),
    prisma.habit.findMany({ where: { userId, deletedAt: null, isActive: true, isTrial: false }, select: { id: true, title: true } }),
    prisma.project.count({ where: { userId, deletedAt: null, status: "COMPLETED", completedAt: { gte: projectWindowStart } } }),
    fetchActiveDayKeys(userId, daysAgo(now, WIDE_WINDOW_DAYS), now),
  ]);

  const skillCategoryIds = new Set(skillCategories.map((c) => c.id));
  const skillCandidates30d = report30d.timeByCategory
    .filter((c) => skillCategoryIds.has(c.categoryId))
    .map((c) => ({ categoryId: c.categoryId, name: c.name, minutes: c.minutes }));

  const checkIns = habits.length
    ? await prisma.habitCheckIn.findMany({
        where: { habitId: { in: habits.map((h) => h.id) }, date: { gte: projectWindowStart } },
        select: { habitId: true, date: true },
      })
    : [];
  const checkInsByHabit = new Map<string, Date[]>();
  for (const c of checkIns) {
    if (!checkInsByHabit.has(c.habitId)) checkInsByHabit.set(c.habitId, []);
    checkInsByHabit.get(c.habitId)!.push(c.date);
  }
  const habitCandidates = habits.map((h) => ({ habitId: h.id, title: h.title, checkInDates: checkInsByHabit.get(h.id) ?? [] }));

  const topCategory90d = [...report90d.timeByCategory].sort((a, b) => b.minutes - a.minutes)[0] ?? null;

  return {
    now,
    dataDays: capital.firstRecordAt ? Math.floor((now.getTime() - capital.firstRecordAt.getTime()) / 86_400_000) : 0,
    skillCandidates30d,
    habitCandidates,
    completedProjectsCount,
    projectWindowStart,
    topCategory90d: topCategory90d ? { categoryId: topCategory90d.categoryId, name: topCategory90d.name, minutes: topCategory90d.minutes } : null,
    totalMinutes90d: report90d.totalDurationMin,
    loggingActiveDayKeys,
  };
}

export async function computeIdentityStatements(userId: string): Promise<IdentityStatement[]> {
  const ctx = await buildContext(userId);
  return buildIdentityStatements(ctx);
}
