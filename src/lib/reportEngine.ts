import { prisma } from "./db";
import { computeHourlyValue } from "./hourlyValue";
import { computeTimeCost } from "./timeCost";
import { computeAdherenceSeries, computeCurrentStreak, daysSinceLastCheckIn, type DayAdherence } from "./habitStreak";
import { dayKeyIso } from "./calendarGrid";
import { toJalali, jalaliMonthRange, jalaliDateKey } from "./jalali";
import { computeDaySegments, type TimedInterval, type CategoryKindForBattery, type DayBatteryResult } from "./dayBattery";

export interface TimeAndMoneyReport {
  from: Date;
  to: Date;
  hourlyValue: number;

  totalDurationMin: number;
  productiveMin: number;
  neutralMin: number;
  wasteMin: number;
  productiveRatio: number; // 0-1

  timeByCategory: { categoryId: string; name: string; color: string; kind: string; minutes: number }[];
  timeByProject: { projectId: string; name: string; minutes: number }[];

  income: number;
  expense: number;
  net: number;
  expenseByCategory: { categoryId: string; name: string; color: string; amount: number }[];

  timeCost: number;
  opportunityCost: number;
  realCost: number;

  virtualAssetValue: number;
  tasksCompleted: number;
  eventsCount: number;
}

export async function computeTimeAndMoneyReport(userId: string, from: Date, to: Date): Promise<TimeAndMoneyReport> {
  const [settings, timeEntries, loggedTasks, doneEventCompletions, loggedHabitCheckIns, transactions, virtualAssetEntries, tasksCompleted, eventsCount] =
    await Promise.all([
      prisma.settings.findUnique({ where: { userId } }),
      prisma.timeEntry.findMany({
        where: { activity: { userId, deletedAt: null }, startAt: { gte: from, lte: to }, durationMin: { not: null } },
        include: { activity: { include: { category: true, project: true } } },
      }),
      // Task time logged directly via Quick Capture's startAt/endAt (no Activity/TimeEntry
      // involved) — omitted here before, which is why logged task time never showed up in
      // the main time report even though it was fully captured in the DB.
      prisma.task.findMany({
        where: { userId, deletedAt: null, startAt: { gte: from, lte: to }, endAt: { not: null } },
        include: { category: true, project: true },
      }),
      // Only completed occurrences count toward the time report — see EventCompletion.
      prisma.eventCompletion.findMany({
        where: { occurrenceDate: { gte: from, lte: to }, event: { userId, deletedAt: null } },
        include: { event: { include: { category: true, project: true } } },
      }),
      // Habit check-ins with a logged duration (see HabitCheckIn.durationMin) — an optional
      // follow-up to checking in, not required, so most check-ins simply won't match this.
      prisma.habitCheckIn.findMany({
        where: { habit: { userId, deletedAt: null }, date: { gte: from, lte: to }, durationMin: { not: null } },
        include: { habit: { include: { category: true } } },
      }),
      prisma.transaction.findMany({
        where: { userId, deletedAt: null, date: { gte: from, lte: to } },
        include: { category: true },
      }),
      prisma.virtualAssetEntry.findMany({ where: { userId, date: { gte: from, lte: to } } }),
      prisma.task.count({ where: { userId, deletedAt: null, completedAt: { gte: from, lte: to } } }),
      prisma.event.count({ where: { userId, deletedAt: null, startAt: { gte: from, lte: to } } }),
    ]);

  const hourlyValue = computeHourlyValue(settings ?? {});

  let totalDurationMin = 0;
  let productiveMin = 0;
  let neutralMin = 0;
  let wasteMin = 0;
  const byCategory = new Map<string, { name: string; color: string; kind: string; minutes: number }>();
  const byProject = new Map<string, { name: string; minutes: number }>();

  for (const te of timeEntries) {
    const minutes = te.durationMin ?? 0;
    totalDurationMin += minutes;

    const kind = te.activity.category?.kind ?? "NEUTRAL";
    if (kind === "PRODUCTIVE") productiveMin += minutes;
    else if (kind === "WASTE") wasteMin += minutes;
    else neutralMin += minutes;

    if (te.activity.category) {
      const cat = te.activity.category;
      const entry = byCategory.get(cat.id) ?? { name: cat.name, color: cat.color, kind, minutes: 0 };
      entry.minutes += minutes;
      byCategory.set(cat.id, entry);
    }

    if (te.activity.project) {
      const proj = te.activity.project;
      const entry = byProject.get(proj.id) ?? { name: proj.name, minutes: 0 };
      entry.minutes += minutes;
      byProject.set(proj.id, entry);
    }
  }

  for (const task of loggedTasks) {
    const minutes = Math.max(0, Math.round((task.endAt!.getTime() - task.startAt!.getTime()) / 60000));
    totalDurationMin += minutes;

    const kind = task.category?.kind ?? "NEUTRAL";
    if (kind === "PRODUCTIVE") productiveMin += minutes;
    else if (kind === "WASTE") wasteMin += minutes;
    else neutralMin += minutes;

    if (task.category) {
      const entry = byCategory.get(task.category.id) ?? { name: task.category.name, color: task.category.color, kind, minutes: 0 };
      entry.minutes += minutes;
      byCategory.set(task.category.id, entry);
    }

    if (task.project) {
      const entry = byProject.get(task.project.id) ?? { name: task.project.name, minutes: 0 };
      entry.minutes += minutes;
      byProject.set(task.project.id, entry);
    }
  }

  for (const completion of doneEventCompletions) {
    const event = completion.event;
    const minutes = event.allDay ? 0 : Math.max(0, Math.round((event.endAt.getTime() - event.startAt.getTime()) / 60000));
    totalDurationMin += minutes;

    const kind = event.category?.kind ?? "NEUTRAL";
    if (kind === "PRODUCTIVE") productiveMin += minutes;
    else if (kind === "WASTE") wasteMin += minutes;
    else neutralMin += minutes;

    if (event.category) {
      const entry = byCategory.get(event.category.id) ?? { name: event.category.name, color: event.category.color, kind, minutes: 0 };
      entry.minutes += minutes;
      byCategory.set(event.category.id, entry);
    }

    if (event.project) {
      const entry = byProject.get(event.project.id) ?? { name: event.project.name, minutes: 0 };
      entry.minutes += minutes;
      byProject.set(event.project.id, entry);
    }
  }

  for (const checkIn of loggedHabitCheckIns) {
    const minutes = checkIn.durationMin ?? 0;
    totalDurationMin += minutes;

    const kind = checkIn.habit.category?.kind ?? "NEUTRAL";
    if (kind === "PRODUCTIVE") productiveMin += minutes;
    else if (kind === "WASTE") wasteMin += minutes;
    else neutralMin += minutes;

    if (checkIn.habit.category) {
      const cat = checkIn.habit.category;
      const entry = byCategory.get(cat.id) ?? { name: cat.name, color: cat.color, kind, minutes: 0 };
      entry.minutes += minutes;
      byCategory.set(cat.id, entry);
    }
  }

  let income = 0;
  let expense = 0;
  const expenseByCategory = new Map<string, { name: string; color: string; amount: number }>();

  for (const tx of transactions) {
    if (tx.type === "INCOME") income += tx.amount;
    else if (tx.type === "EXPENSE") {
      expense += tx.amount;
      if (tx.category) {
        const entry = expenseByCategory.get(tx.category.id) ?? {
          name: tx.category.name,
          color: tx.category.color,
          amount: 0,
        };
        entry.amount += tx.amount;
        expenseByCategory.set(tx.category.id, entry);
      }
    }
  }

  const timeCost = computeTimeCost(totalDurationMin, hourlyValue);
  const opportunityCost = computeTimeCost(wasteMin, hourlyValue);
  const virtualAssetValue = virtualAssetEntries.reduce((s, e) => s + e.totalValue, 0);

  return {
    from,
    to,
    hourlyValue,
    totalDurationMin,
    productiveMin,
    neutralMin,
    wasteMin,
    productiveRatio: totalDurationMin > 0 ? productiveMin / totalDurationMin : 0,
    timeByCategory: Array.from(byCategory.entries()).map(([categoryId, v]) => ({ categoryId, ...v })),
    timeByProject: Array.from(byProject.entries()).map(([projectId, v]) => ({ projectId, ...v })),
    income,
    expense,
    net: income - expense,
    expenseByCategory: Array.from(expenseByCategory.entries()).map(([categoryId, v]) => ({ categoryId, ...v })),
    timeCost,
    opportunityCost,
    realCost: expense + timeCost,
    virtualAssetValue,
    tasksCompleted,
    eventsCount,
  };
}

export interface HiddenCostItem {
  entityType: "TASK" | "EVENT";
  id: string;
  title: string;
  categoryName: string | null;
  directCost: number;
  durationMin: number;
  timeCost: number;
  hiddenCost: number; // directCost + timeCost — the "true" cost beyond what was actually paid
  date: Date;
}

export interface HiddenCostReport {
  items: HiddenCostItem[];
  totalDirectCost: number;
  totalTimeCost: number;
  totalHiddenCost: number;
}

/**
 * "هزینه پنهان" (Hidden Cost): for Tasks/Events that carry a direct cost and/or an
 * explicitly-entered start/end time, surfaces directCost + timeCost per item. Only items
 * where the user actually entered time count toward timeCost (an all-day Event or a Task
 * with no startAt/endAt contributes 0) — this deliberately doesn't blanket-apply time cost
 * to every calendar entry, only to time the user chose to log.
 */
export async function computeHiddenCostReport(userId: string, from: Date, to: Date): Promise<HiddenCostReport> {
  const settings = await prisma.settings.findUnique({ where: { userId } });
  const hourlyValue = computeHourlyValue(settings ?? {});

  const [tasks, events] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId,
        deletedAt: null,
        AND: [
          {
            OR: [
              { startAt: { gte: from, lte: to } },
              { dueDate: { gte: from, lte: to } },
              { createdAt: { gte: from, lte: to } },
            ],
          },
          { OR: [{ directCost: { gt: 0 } }, { AND: [{ startAt: { not: null } }, { endAt: { not: null } }] }] },
        ],
      },
      include: { category: true },
    }),
    prisma.event.findMany({
      where: {
        userId,
        deletedAt: null,
        startAt: { gte: from, lte: to },
        OR: [{ directCost: { gt: 0 } }, { allDay: false }],
      },
      include: { category: true },
    }),
  ]);

  const items: HiddenCostItem[] = [];

  for (const t of tasks) {
    const durationMin =
      t.startAt && t.endAt ? Math.max(0, Math.round((t.endAt.getTime() - t.startAt.getTime()) / 60000)) : 0;
    const timeCost = computeTimeCost(durationMin, hourlyValue);
    items.push({
      entityType: "TASK",
      id: t.id,
      title: t.title,
      categoryName: t.category?.name ?? null,
      directCost: t.directCost,
      durationMin,
      timeCost,
      hiddenCost: t.directCost + timeCost,
      date: t.startAt ?? t.dueDate ?? t.createdAt,
    });
  }

  for (const e of events) {
    const durationMin = e.allDay ? 0 : Math.max(0, Math.round((e.endAt.getTime() - e.startAt.getTime()) / 60000));
    const timeCost = computeTimeCost(durationMin, hourlyValue);
    items.push({
      entityType: "EVENT",
      id: e.id,
      title: e.title,
      categoryName: e.category?.name ?? null,
      directCost: e.directCost,
      durationMin,
      timeCost,
      hiddenCost: e.directCost + timeCost,
      date: e.startAt,
    });
  }

  items.sort((a, b) => b.hiddenCost - a.hiddenCost);

  return {
    items,
    totalDirectCost: items.reduce((s, i) => s + i.directCost, 0),
    totalTimeCost: items.reduce((s, i) => s + i.timeCost, 0),
    totalHiddenCost: items.reduce((s, i) => s + i.hiddenCost, 0),
  };
}

export interface NetWorthReport {
  realAssetsValue: number;
  virtualAssetsValue: number;
  totalDebt: number;
  netWorth: number;
}

export async function computeNetWorth(userId: string): Promise<NetWorthReport> {
  const [assets, virtualAssetEntries, plans] = await Promise.all([
    prisma.asset.findMany({ where: { userId, deletedAt: null } }),
    prisma.virtualAssetEntry.findMany({ where: { userId } }),
    prisma.installmentPlan.findMany({
      where: { userId, deletedAt: null },
      include: { installments: true },
    }),
  ]);

  const realAssetsValue = assets.reduce((s, a) => s + a.currentValue, 0);
  const virtualAssetsValue = virtualAssetEntries.reduce((s, e) => s + e.totalValue, 0);
  const totalDebt = plans.reduce(
    (s, plan) => s + plan.installments.filter((i) => i.status !== "PAID").reduce((s2, i) => s2 + i.amount, 0),
    0
  );

  return {
    realAssetsValue,
    virtualAssetsValue,
    totalDebt,
    netWorth: realAssetsValue + virtualAssetsValue - totalDebt,
  };
}

export interface HabitStat {
  id: string;
  title: string;
  icon: string | null;
  color: string;
  isActive: boolean;
  currentStreak: number;
  daysSinceLastCheckIn: number;
  virtualAssetValue: number; // within [from, to]
}

export interface HabitsReport {
  habits: HabitStat[];
  series: DayAdherence[]; // within [from, to]
  currentStreak: number; // always as-of-today, independent of the report's [from, to]
  digitalAssetTotal: number; // within [from, to]
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const STREAK_LOOKBACK_DAYS = 60;

/**
 * "عادت‌ها" report tab: adherence series for the requested range, plus per-habit
 * streak/neglect stats and the digital-asset total those check-ins generated. The overall
 * streak is always computed as-of-today over a fixed lookback window — a streak is a "right
 * now" fact, not something that changes depending on which reporting period is selected.
 */
export async function computeHabitsReport(userId: string, from: Date, to: Date): Promise<HabitsReport> {
  const today = startOfDay(new Date());
  const streakFrom = new Date(today.getTime() - STREAK_LOOKBACK_DAYS * 86_400_000);
  const rangeFrom = startOfDay(from);
  // Clamp to today — a preset like "این ماه"/"امسال" spans into future days that haven't
  // happened yet, which would otherwise render as a misleading 0% adherence crash on the chart.
  const rangeTo = startOfDay(to) > today ? today : startOfDay(to);

  // Trial habits (BJ Fogg's 3-day Tiny Habits experiments) are intentionally excluded from
  // this report — they're not yet committed habits, and shouldn't skew streaks or the
  // digital-asset total. They live only on /habits until the user decides to keep them.
  const [habits, rangeCheckIns, streakCheckIns, vaEntries] = await Promise.all([
    prisma.habit.findMany({ where: { userId, deletedAt: null, isTrial: false } }),
    prisma.habitCheckIn.findMany({ where: { habit: { userId, deletedAt: null, isTrial: false }, date: { gte: rangeFrom, lte: rangeTo } } }),
    prisma.habitCheckIn.findMany({ where: { habit: { userId, deletedAt: null, isTrial: false }, date: { gte: streakFrom, lte: today } } }),
    prisma.virtualAssetEntry.findMany({
      where: { userId, habitCheckInId: { not: null }, date: { gte: from, lte: to }, habitCheckIn: { habit: { isTrial: false } } },
      include: { habitCheckIn: { select: { habitId: true } } },
    }),
  ]);

  const series = computeAdherenceSeries(habits, rangeCheckIns, rangeFrom, rangeTo);
  const streakSeries = computeAdherenceSeries(habits, streakCheckIns, streakFrom, today);
  const currentStreak = computeCurrentStreak(streakSeries, today);

  const lastCheckInByHabit = new Map<string, Date>();
  const checkedDaysByHabit = new Map<string, Set<number>>();
  for (const c of streakCheckIns) {
    const prev = lastCheckInByHabit.get(c.habitId);
    if (!prev || c.date > prev) lastCheckInByHabit.set(c.habitId, c.date);
    if (!checkedDaysByHabit.has(c.habitId)) checkedDaysByHabit.set(c.habitId, new Set());
    checkedDaysByHabit.get(c.habitId)!.add(c.date.getTime());
  }

  const vaByHabit = new Map<string, number>();
  for (const e of vaEntries) {
    const habitId = e.habitCheckIn?.habitId;
    if (!habitId) continue;
    vaByHabit.set(habitId, (vaByHabit.get(habitId) ?? 0) + e.totalValue);
  }

  // Per-habit streak: consecutive days THIS habit alone was checked in — distinct from the
  // overall day streak above, which uses the 80%-across-all-habits threshold.
  function perHabitStreak(habitId: string): number {
    const checkedDays = checkedDaysByHabit.get(habitId) ?? new Set<number>();
    const perHabitSeries: DayAdherence[] = streakSeries.map((day) => {
      const checkedIn = checkedDays.has(day.date.getTime()) ? 1 : 0;
      return { date: day.date, total: 1, checkedIn, ratio: checkedIn };
    });
    return computeCurrentStreak(perHabitSeries, today, 1);
  }

  const habitStats: HabitStat[] = habits.map((h) => {
    const last = lastCheckInByHabit.get(h.id);
    return {
      id: h.id,
      title: h.title,
      icon: h.icon,
      color: h.color,
      isActive: h.isActive,
      currentStreak: perHabitStreak(h.id),
      daysSinceLastCheckIn: daysSinceLastCheckIn(last ? [{ habitId: h.id, date: last }] : [], h.createdAt, today),
      virtualAssetValue: vaByHabit.get(h.id) ?? 0,
    };
  });

  return {
    habits: habitStats,
    series,
    currentStreak,
    digitalAssetTotal: vaEntries.reduce((s, e) => s + e.totalValue, 0),
  };
}

export interface CategoryCalendarStat {
  categoryId: string;
  name: string;
  icon: string | null;
  color: string;
  totalMinutes: number;
  totalDays: number;
  days: Record<string, number>; // dayKeyIso(date) -> minutes, only days with minutes > 0
}

/**
 * Per-category, per-day time totals for [from, to] (a single month, in practice) — powers
 * the Reports "تقویم دسته‌بندی‌ها" tab. Sources the same four places time is ever logged as
 * the main time report (computeTimeAndMoneyReport): Activity TimeEntry, Task
 * startAt/endAt, completed Event occurrences, and habit check-ins with a logged duration —
 * so a day's total here always matches what the rest of the app already knows about that day.
 */
export async function computeCategoryCalendar(userId: string, from: Date, to: Date): Promise<CategoryCalendarStat[]> {
  const [categories, timeEntries, tasks, completions, habitCheckIns] = await Promise.all([
    prisma.category.findMany({ where: { userId, deletedAt: null } }),
    prisma.timeEntry.findMany({
      where: { activity: { userId, deletedAt: null }, startAt: { gte: from, lte: to }, durationMin: { not: null } },
      include: { activity: { select: { categoryId: true } } },
    }),
    prisma.task.findMany({
      where: { userId, deletedAt: null, startAt: { gte: from, lte: to }, endAt: { not: null } },
      select: { categoryId: true, startAt: true, endAt: true },
    }),
    prisma.eventCompletion.findMany({
      where: { occurrenceDate: { gte: from, lte: to }, event: { userId, deletedAt: null } },
      include: { event: { select: { categoryId: true, startAt: true, endAt: true, allDay: true } } },
    }),
    prisma.habitCheckIn.findMany({
      where: { habit: { userId, deletedAt: null }, date: { gte: from, lte: to }, durationMin: { not: null } },
      include: { habit: { select: { categoryId: true } } },
    }),
  ]);

  const byCategory = new Map<string, Map<string, number>>();

  function addMinutes(categoryId: string | null, date: Date, minutes: number) {
    if (!categoryId || minutes <= 0) return;
    const key = dayKeyIso(date);
    if (!byCategory.has(categoryId)) byCategory.set(categoryId, new Map());
    const dayMap = byCategory.get(categoryId)!;
    dayMap.set(key, (dayMap.get(key) ?? 0) + minutes);
  }

  for (const te of timeEntries) {
    addMinutes(te.activity.categoryId, te.startAt, te.durationMin ?? 0);
  }
  for (const t of tasks) {
    const minutes = Math.max(0, Math.round((t.endAt!.getTime() - t.startAt!.getTime()) / 60000));
    addMinutes(t.categoryId, t.startAt!, minutes);
  }
  for (const c of completions) {
    if (c.event.allDay) continue;
    const minutes = Math.max(0, Math.round((c.event.endAt.getTime() - c.event.startAt.getTime()) / 60000));
    addMinutes(c.event.categoryId, c.occurrenceDate, minutes);
  }
  for (const checkIn of habitCheckIns) {
    addMinutes(checkIn.habit.categoryId, checkIn.date, checkIn.durationMin ?? 0);
  }

  return categories.map((cat) => {
    const dayMap = byCategory.get(cat.id) ?? new Map<string, number>();
    const days: Record<string, number> = {};
    let totalMinutes = 0;
    for (const [key, minutes] of dayMap) {
      days[key] = minutes;
      totalMinutes += minutes;
    }
    return {
      categoryId: cat.id,
      name: cat.name,
      icon: cat.icon,
      color: cat.color,
      totalMinutes,
      totalDays: dayMap.size,
      days,
    };
  });
}

// --- computeFounderCapital ("سرمایه من") ----------------------------------------------------

export interface FounderCapital {
  investedMinutes: number;
  virtualAssetValue: number;
  skillCount: number;
  projectCount: number;
  assetCount: number;
  firstRecordAt: Date | null;
  todayDeltaMinutes: number;
  monthDeltaMinutes: number;
}

/**
 * Three additive, non-overlapping time sources, optionally restricted to rows on/after `from`
 * (omit for lifetime): TimeEntry minutes logged under a PRODUCTIVE category, HabitCheckIn
 * minutes (any category — a kept habit counts regardless of its category tag), and Task-level
 * startAt/endAt minutes for tasks attached to a project (the Quick Capture "log time on a
 * project task" path, which never creates an Activity/TimeEntry, so it can't double-count with
 * the first term).
 */
async function sumInvestedMinutes(userId: string, from?: Date): Promise<number> {
  const [productive, habitCheckIns, projectTasks] = await Promise.all([
    prisma.timeEntry.aggregate({
      _sum: { durationMin: true },
      where: {
        activity: { userId, deletedAt: null, category: { kind: "PRODUCTIVE" } },
        durationMin: { not: null },
        ...(from ? { startAt: { gte: from } } : {}),
      },
    }),
    prisma.habitCheckIn.findMany({
      where: { habit: { userId, deletedAt: null }, durationMin: { not: null }, ...(from ? { date: { gte: from } } : {}) },
      select: { durationMin: true },
    }),
    prisma.task.findMany({
      where: { userId, deletedAt: null, projectId: { not: null }, startAt: { not: null }, endAt: { not: null }, ...(from ? { startAt: { gte: from } } : {}) },
      select: { startAt: true, endAt: true },
    }),
  ]);

  const habitMin = habitCheckIns.reduce((s, c) => s + (c.durationMin ?? 0), 0);
  const taskMin = projectTasks.reduce((s, t) => s + Math.max(0, Math.round((t.endAt!.getTime() - t.startAt!.getTime()) / 60000)), 0);

  return (productive._sum.durationMin ?? 0) + habitMin + taskMin;
}

/**
 * Lifetime TimeEntry minutes logged under one specific category — for narrative.ts's Act 3
 * ("چه ساختی"), which names the period's top-productive category and reports its running total.
 * Deliberately scoped to TimeEntry only (not the full TimeEntry+Task+Event+HabitCheckIn mix
 * computeTimeAndMoneyReport's timeByCategory uses) — a lighter, targeted query for just the one
 * category the narrative ends up naming, rather than recomputing the whole report lifetime-wide.
 */
export async function sumCategoryLifetimeMinutes(userId: string, categoryId: string): Promise<number> {
  const result = await prisma.timeEntry.aggregate({
    _sum: { durationMin: true },
    where: { activity: { userId, deletedAt: null, categoryId }, durationMin: { not: null } },
  });
  return result._sum.durationMin ?? 0;
}

/** Same idea as sumCategoryLifetimeMinutes, filtered by project instead — insights.ts's
 * milestoneHours checks both categories and projects for a crossed hour threshold. */
export async function sumProjectLifetimeMinutes(userId: string, projectId: string): Promise<number> {
  const result = await prisma.timeEntry.aggregate({
    _sum: { durationMin: true },
    where: { activity: { userId, deletedAt: null, projectId }, durationMin: { not: null } },
  });
  return result._sum.durationMin ?? 0;
}

/**
 * "سرمایه من": lifetime accumulation across every table that represents time or value the user
 * has actually put in — deliberately the one dashboard number that only ever goes up (see the
 * product brief). firstRecordAt is null (triggering the empty state) only when none of the
 * contributing tables have a single row yet.
 */
export async function computeFounderCapital(userId: string): Promise<FounderCapital> {
  const now = new Date();
  const today = startOfDay(now);
  const { jy, jm } = toJalali(now);
  const monthStart = jalaliMonthRange(jy, jm).start;

  const [
    investedMinutes,
    todayDeltaMinutes,
    monthDeltaMinutes,
    virtualAssetValue,
    skillCategories,
    projectCount,
    assetCount,
    firstActivity,
    firstHabitCheckIn,
    firstVirtualAsset,
    firstProjectTask,
  ] = await Promise.all([
    sumInvestedMinutes(userId),
    sumInvestedMinutes(userId, today),
    sumInvestedMinutes(userId, monthStart),
    prisma.virtualAssetEntry.aggregate({ _sum: { totalValue: true }, where: { userId } }).then((r) => r._sum.totalValue ?? 0),
    prisma.virtualAssetEntry.findMany({ where: { userId, categoryId: { not: null } }, select: { categoryId: true }, distinct: ["categoryId"] }),
    prisma.project.count({ where: { userId, deletedAt: null, status: "COMPLETED" } }),
    prisma.asset.count({ where: { userId, deletedAt: null } }),
    prisma.activity.findFirst({ where: { userId, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.habitCheckIn.findFirst({ where: { habit: { userId, deletedAt: null } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.virtualAssetEntry.findFirst({ where: { userId }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.task.findFirst({ where: { userId, deletedAt: null, projectId: { not: null } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);

  const firstDates = [firstActivity, firstHabitCheckIn, firstVirtualAsset, firstProjectTask]
    .map((r) => r?.createdAt)
    .filter((d): d is Date => !!d);
  const firstRecordAt = firstDates.length > 0 ? new Date(Math.min(...firstDates.map((d) => d.getTime()))) : null;

  return {
    investedMinutes,
    virtualAssetValue,
    skillCount: skillCategories.length,
    projectCount,
    assetCount,
    firstRecordAt,
    todayDeltaMinutes,
    monthDeltaMinutes,
  };
}

/**
 * Idempotent upsert of today's (Jalali) CapitalSnapshot row — safe to call as often as the app
 * likes in a day (first-run, boot, resume, or every /api/capital read); it always converges to
 * the latest true totals for today rather than freezing at whatever the first call that day saw.
 * Returns the freshly-computed capital so callers don't need to recompute it separately.
 */
export async function recordDailyCapitalSnapshot(userId: string): Promise<FounderCapital> {
  const capital = await computeFounderCapital(userId);
  const date = jalaliDateKey(new Date());
  await prisma.capitalSnapshot.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, investedMinutes: capital.investedMinutes, virtualAssetValue: capital.virtualAssetValue },
    update: { investedMinutes: capital.investedMinutes, virtualAssetValue: capital.virtualAssetValue },
  });
  return capital;
}

// --- computeDayBattery ("DayBattery") -------------------------------------------------------

/**
 * Today's waking-hours timeline (see src/lib/dayBattery.ts's computeDaySegments for the pure
 * sweep algorithm this wraps). Three chronologically-positioned time sources, deliberately not
 * the same set computeFounderCapital uses: ALL categories count here (not just PRODUCTIVE), and
 * ALL tasks with a logged startAt/endAt count (not just project-linked ones) — this is "where did
 * today's time actually go", not "invested capital". HabitCheckIn is excluded (see dayBattery.ts's
 * own comment): it has a real duration but no real clock-time slot to place on a timeline.
 */
/** Every logged interval for `userId` inside [wakeTime, sleepTime) — factored out of
 * computeDayBattery so src/lib/insightsData.ts's unloggedGap wrapper can call it once per day
 * for the last 7 days, not just for today. */
export async function fetchDayIntervals(userId: string, wakeTime: Date, sleepTime: Date): Promise<TimedInterval[]> {
  const [timeEntries, tasks, completions] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { activity: { userId, deletedAt: null }, startAt: { gte: wakeTime, lt: sleepTime }, durationMin: { not: null } },
      include: { activity: { include: { category: true } } },
    }),
    prisma.task.findMany({
      where: { userId, deletedAt: null, startAt: { gte: wakeTime, lt: sleepTime }, endAt: { not: null } },
      include: { category: true },
    }),
    prisma.eventCompletion.findMany({
      where: { occurrenceDate: { gte: wakeTime, lt: sleepTime }, event: { userId, deletedAt: null } },
      include: { event: { include: { category: true } } },
    }),
  ]);

  return [
    ...timeEntries.map((te) => ({
      start: te.startAt,
      end: te.endAt!,
      kind: (te.activity.category?.kind ?? "NEUTRAL") as CategoryKindForBattery,
    })),
    ...tasks.map((t) => ({
      start: t.startAt!,
      end: t.endAt!,
      kind: (t.category?.kind ?? "NEUTRAL") as CategoryKindForBattery,
    })),
    ...completions
      .filter((c) => !c.event.allDay)
      .map((c) => ({
        start: c.event.startAt,
        end: c.event.endAt,
        kind: (c.event.category?.kind ?? "NEUTRAL") as CategoryKindForBattery,
      })),
  ];
}

export async function computeDayBattery(userId: string): Promise<DayBatteryResult> {
  const now = new Date();
  const settings = await prisma.settings.findUnique({ where: { userId } });
  const wakeHour = settings?.wakeHour ?? 7;
  const sleepHour = settings?.sleepHour ?? 23;
  const wakeTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), wakeHour, 0, 0, 0);
  const sleepTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sleepHour, 0, 0, 0);

  const intervals = await fetchDayIntervals(userId, wakeTime, sleepTime);
  return computeDaySegments(wakeTime, sleepTime, now, intervals);
}
