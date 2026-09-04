// On-device mirror of src/lib/identityData.ts — see its own comment for why this stays separate
// from reportEngine.ts. Raw SQL + manual joins instead of Prisma's `include`, same as every other
// local/* mirror in this codebase.
import type { LocalDb } from "./db";
import { computeTimeAndMoneyReport, computeFounderCapital, fetchActiveDayKeys } from "./reportEngine";
import { buildIdentityStatements, type IdentityContext, type IdentityStatement } from "@/lib/identity";

const SKILL_WINDOW_DAYS = 30;
const WIDE_WINDOW_DAYS = 90;

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}
function iso(d: Date) {
  return d.toISOString();
}

function buildContext(db: LocalDb, userId: string): IdentityContext {
  const now = new Date();
  const projectWindowStart = daysAgo(now, WIDE_WINDOW_DAYS);
  const projectWindowStartIso = iso(projectWindowStart);

  const capital = computeFounderCapital(db, userId);
  const report30d = computeTimeAndMoneyReport(db, userId, daysAgo(now, SKILL_WINDOW_DAYS), now);
  const report90d = computeTimeAndMoneyReport(db, userId, daysAgo(now, WIDE_WINDOW_DAYS), now);
  const loggingActiveDayKeys = fetchActiveDayKeys(db, userId, daysAgo(now, WIDE_WINDOW_DAYS), now);

  const skillCategoryRows = db.all<{ id: string }>(`SELECT "id" FROM "Category" WHERE "userId" = ? AND "generatesVirtualAsset" = 1`, [userId]);
  const skillCategoryIds = new Set(skillCategoryRows.map((r) => r.id));
  const skillCandidates30d = report30d.timeByCategory
    .filter((c) => skillCategoryIds.has(c.categoryId))
    .map((c) => ({ categoryId: c.categoryId, name: c.name, minutes: c.minutes }));

  const habitRows = db.all<{ id: string; title: string }>(
    `SELECT "id", "title" FROM "Habit" WHERE "userId" = ? AND "deletedAt" IS NULL AND "isActive" = 1 AND "isTrial" = 0`,
    [userId]
  );
  const checkInRows = habitRows.length
    ? db.all<{ habitId: string; date: string }>(
        `SELECT "habitId", "date" FROM "HabitCheckIn" WHERE "habitId" IN (${habitRows.map(() => "?").join(",")}) AND "date" >= ?`,
        [...habitRows.map((h) => h.id), projectWindowStartIso]
      )
    : [];
  const checkInsByHabit = new Map<string, Date[]>();
  for (const r of checkInRows) {
    if (!checkInsByHabit.has(r.habitId)) checkInsByHabit.set(r.habitId, []);
    checkInsByHabit.get(r.habitId)!.push(new Date(r.date));
  }
  const habitCandidates = habitRows.map((h) => ({ habitId: h.id, title: h.title, checkInDates: checkInsByHabit.get(h.id) ?? [] }));

  const completedProjectsCount = db.get<{ n: number }>(
    `SELECT COUNT(*) as n FROM "Project" WHERE "userId" = ? AND "deletedAt" IS NULL AND "status" = 'COMPLETED' AND "completedAt" >= ?`,
    [userId, projectWindowStartIso]
  )!.n;

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

export function computeIdentityStatements(db: LocalDb, userId: string): IdentityStatement[] {
  return buildIdentityStatements(buildContext(db, userId));
}
