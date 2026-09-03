// On-device port of src/lib/reportEngine.ts. Every aggregation formula below is copied
// verbatim from there — only the data-fetching step changes (raw SQL + manual joins instead
// of Prisma's `include`), since ISO-string comparisons in SQLite are already chronologically
// correct and the pure math (computeHourlyValue/computeTimeCost/computeVirtualAssetValue/
// habitStreak.ts) doesn't care where its inputs came from. Keep this file's aggregation logic
// in sync with reportEngine.ts by eye when one changes — there's no automated check for that.
import { computeHourlyValue } from "@/lib/hourlyValue";
import { computeTimeCost } from "@/lib/timeCost";
import { computeAdherenceSeries, computeCurrentStreak, daysSinceLastCheckIn, type DayAdherence, type HabitLike, type HabitCheckInLike } from "@/lib/habitStreak";
import { dayKeyIso } from "@/lib/calendarGrid";
import { toJalali, jalaliMonthRange, jalaliDateKey } from "@/lib/jalali";
import { computeDaySegments, type TimedInterval, type CategoryKindForBattery, type DayBatteryResult } from "@/lib/dayBattery";
import type { LocalDb } from "./db";
import { fetchByIds } from "./relations";

function iso(d: Date) {
  return d.toISOString();
}
function parseDate(s: string): Date {
  return new Date(s);
}

// --- computeTimeAndMoneyReport ------------------------------------------------------------

export interface TimeAndMoneyReport {
  from: Date;
  to: Date;
  hourlyValue: number;
  totalDurationMin: number;
  productiveMin: number;
  neutralMin: number;
  wasteMin: number;
  productiveRatio: number;
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

interface CategoryRow {
  id: string;
  name: string;
  color: string;
  kind: string;
}
interface ProjectRow {
  id: string;
  name: string;
}

export function computeTimeAndMoneyReport(db: LocalDb, userId: string, from: Date, to: Date): TimeAndMoneyReport {
  const fromIso = iso(from);
  const toIso = iso(to);

  const settings = db.get<{ monthlyIncome: number | null; workingHoursMonth: number | null; hourlyValueOverride: number | null }>(
    `SELECT * FROM "Settings" WHERE "userId" = ?`,
    [userId]
  );
  const hourlyValue = computeHourlyValue(settings ?? {});

  const timeEntries = db.all<{ durationMin: number | null; categoryId: string | null; projectId: string | null }>(
    `SELECT te."durationMin", a."categoryId" as "categoryId", a."projectId" as "projectId"
     FROM "TimeEntry" te JOIN "Activity" a ON a."id" = te."activityId"
     WHERE a."userId" = ? AND a."deletedAt" IS NULL AND te."startAt" >= ? AND te."startAt" <= ? AND te."durationMin" IS NOT NULL`,
    [userId, fromIso, toIso]
  );
  const loggedTasks = db.all<{ startAt: string; endAt: string; categoryId: string | null; projectId: string | null }>(
    `SELECT "startAt", "endAt", "categoryId", "projectId" FROM "Task"
     WHERE "userId" = ? AND "deletedAt" IS NULL AND "startAt" >= ? AND "startAt" <= ? AND "endAt" IS NOT NULL`,
    [userId, fromIso, toIso]
  );
  const doneEventCompletions = db.all<{ occurrenceDate: string; eventStartAt: string; eventEndAt: string; eventAllDay: number; categoryId: string | null; projectId: string | null }>(
    `SELECT ec."occurrenceDate", e."startAt" as "eventStartAt", e."endAt" as "eventEndAt", e."allDay" as "eventAllDay", e."categoryId", e."projectId"
     FROM "EventCompletion" ec JOIN "Event" e ON e."id" = ec."eventId"
     WHERE e."userId" = ? AND e."deletedAt" IS NULL AND ec."occurrenceDate" >= ? AND ec."occurrenceDate" <= ?`,
    [userId, fromIso, toIso]
  );
  const loggedHabitCheckIns = db.all<{ durationMin: number | null; categoryId: string | null }>(
    `SELECT hc."durationMin", h."categoryId" FROM "HabitCheckIn" hc JOIN "Habit" h ON h."id" = hc."habitId"
     WHERE h."userId" = ? AND h."deletedAt" IS NULL AND hc."date" >= ? AND hc."date" <= ? AND hc."durationMin" IS NOT NULL`,
    [userId, fromIso, toIso]
  );
  const transactions = db.all<{ type: string; amount: number; categoryId: string | null }>(
    `SELECT "type", "amount", "categoryId" FROM "Transaction" WHERE "userId" = ? AND "deletedAt" IS NULL AND "date" >= ? AND "date" <= ?`,
    [userId, fromIso, toIso]
  );
  const virtualAssetEntries = db.all<{ totalValue: number }>(`SELECT "totalValue" FROM "VirtualAssetEntry" WHERE "userId" = ? AND "date" >= ? AND "date" <= ?`, [userId, fromIso, toIso]);
  const tasksCompleted = db.get<{ n: number }>(
    `SELECT COUNT(*) as n FROM "Task" WHERE "userId" = ? AND "deletedAt" IS NULL AND "completedAt" >= ? AND "completedAt" <= ?`,
    [userId, fromIso, toIso]
  )!.n;
  const eventsCount = db.get<{ n: number }>(`SELECT COUNT(*) as n FROM "Event" WHERE "userId" = ? AND "deletedAt" IS NULL AND "startAt" >= ? AND "startAt" <= ?`, [userId, fromIso, toIso])!.n;

  const allCategoryIds = [
    ...timeEntries.map((r) => r.categoryId),
    ...loggedTasks.map((r) => r.categoryId),
    ...doneEventCompletions.map((r) => r.categoryId),
    ...loggedHabitCheckIns.map((r) => r.categoryId),
    ...transactions.map((r) => r.categoryId),
  ];
  const categoryById = fetchByIds<CategoryRow>(db, "Category", allCategoryIds);
  const projectById = fetchByIds<ProjectRow>(
    db,
    "Project",
    [...timeEntries.map((r) => r.projectId), ...loggedTasks.map((r) => r.projectId), ...doneEventCompletions.map((r) => r.projectId)]
  );

  let totalDurationMin = 0;
  let productiveMin = 0;
  let neutralMin = 0;
  let wasteMin = 0;
  const byCategory = new Map<string, { name: string; color: string; kind: string; minutes: number }>();
  const byProject = new Map<string, { name: string; minutes: number }>();

  function addTime(categoryId: string | null, projectId: string | null, minutes: number) {
    totalDurationMin += minutes;
    const cat = categoryId ? categoryById.get(categoryId) : undefined;
    const kind = cat?.kind ?? "NEUTRAL";
    if (kind === "PRODUCTIVE") productiveMin += minutes;
    else if (kind === "WASTE") wasteMin += minutes;
    else neutralMin += minutes;

    if (cat) {
      const entry = byCategory.get(cat.id) ?? { name: cat.name, color: cat.color, kind, minutes: 0 };
      entry.minutes += minutes;
      byCategory.set(cat.id, entry);
    }
    const proj = projectId ? projectById.get(projectId) : undefined;
    if (proj) {
      const entry = byProject.get(proj.id) ?? { name: proj.name, minutes: 0 };
      entry.minutes += minutes;
      byProject.set(proj.id, entry);
    }
  }

  for (const te of timeEntries) addTime(te.categoryId, te.projectId, te.durationMin ?? 0);
  for (const t of loggedTasks) {
    const minutes = Math.max(0, Math.round((parseDate(t.endAt).getTime() - parseDate(t.startAt).getTime()) / 60000));
    addTime(t.categoryId, t.projectId, minutes);
  }
  for (const c of doneEventCompletions) {
    const minutes = c.eventAllDay ? 0 : Math.max(0, Math.round((parseDate(c.eventEndAt).getTime() - parseDate(c.eventStartAt).getTime()) / 60000));
    addTime(c.categoryId, c.projectId, minutes);
  }
  for (const checkIn of loggedHabitCheckIns) addTime(checkIn.categoryId, null, checkIn.durationMin ?? 0);

  let income = 0;
  let expense = 0;
  const expenseByCategory = new Map<string, { name: string; color: string; amount: number }>();
  for (const tx of transactions) {
    if (tx.type === "INCOME") income += tx.amount;
    else if (tx.type === "EXPENSE") {
      expense += tx.amount;
      const cat = tx.categoryId ? categoryById.get(tx.categoryId) : undefined;
      if (cat) {
        const entry = expenseByCategory.get(cat.id) ?? { name: cat.name, color: cat.color, amount: 0 };
        entry.amount += tx.amount;
        expenseByCategory.set(cat.id, entry);
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

// --- computeHiddenCostReport ---------------------------------------------------------------

export interface HiddenCostItem {
  entityType: "TASK" | "EVENT";
  id: string;
  title: string;
  categoryName: string | null;
  directCost: number;
  durationMin: number;
  timeCost: number;
  hiddenCost: number;
  date: Date;
}
export interface HiddenCostReport {
  items: HiddenCostItem[];
  totalDirectCost: number;
  totalTimeCost: number;
  totalHiddenCost: number;
}

export function computeHiddenCostReport(db: LocalDb, userId: string, from: Date, to: Date): HiddenCostReport {
  const fromIso = iso(from);
  const toIso = iso(to);
  const settings = db.get<{ monthlyIncome: number | null; workingHoursMonth: number | null; hourlyValueOverride: number | null }>(
    `SELECT * FROM "Settings" WHERE "userId" = ?`,
    [userId]
  );
  const hourlyValue = computeHourlyValue(settings ?? {});

  // Mirrors the web route's three-way OR on date fields (startAt / dueDate / createdAt).
  const tasks = db.all<{ id: string; title: string; categoryId: string | null; directCost: number; startAt: string | null; endAt: string | null; dueDate: string | null; createdAt: string }>(
    `SELECT "id","title","categoryId","directCost","startAt","endAt","dueDate","createdAt" FROM "Task"
     WHERE "userId" = ? AND "deletedAt" IS NULL
       AND (
         ("startAt" >= ? AND "startAt" <= ?) OR
         ("dueDate" >= ? AND "dueDate" <= ?) OR
         ("createdAt" >= ? AND "createdAt" <= ?)
       )
       AND ("directCost" > 0 OR ("startAt" IS NOT NULL AND "endAt" IS NOT NULL))`,
    [userId, fromIso, toIso, fromIso, toIso, fromIso, toIso]
  );

  const events = db.all<{ id: string; title: string; categoryId: string | null; directCost: number; startAt: string; endAt: string; allDay: number }>(
    `SELECT "id","title","categoryId","directCost","startAt","endAt","allDay" FROM "Event"
     WHERE "userId" = ? AND "deletedAt" IS NULL AND "startAt" >= ? AND "startAt" <= ? AND ("directCost" > 0 OR "allDay" = 0)`,
    [userId, fromIso, toIso]
  );

  const categoryById = fetchByIds<CategoryRow>(db, "Category", [...tasks.map((t) => t.categoryId), ...events.map((e) => e.categoryId)]);

  const items: HiddenCostItem[] = [];
  for (const t of tasks) {
    const durationMin = t.startAt && t.endAt ? Math.max(0, Math.round((parseDate(t.endAt).getTime() - parseDate(t.startAt).getTime()) / 60000)) : 0;
    const timeCost = computeTimeCost(durationMin, hourlyValue);
    items.push({
      entityType: "TASK",
      id: t.id,
      title: t.title,
      categoryName: t.categoryId ? categoryById.get(t.categoryId)?.name ?? null : null,
      directCost: t.directCost,
      durationMin,
      timeCost,
      hiddenCost: t.directCost + timeCost,
      date: parseDate(t.startAt ?? t.dueDate ?? t.createdAt),
    });
  }
  for (const e of events) {
    const durationMin = e.allDay ? 0 : Math.max(0, Math.round((parseDate(e.endAt).getTime() - parseDate(e.startAt).getTime()) / 60000));
    const timeCost = computeTimeCost(durationMin, hourlyValue);
    items.push({
      entityType: "EVENT",
      id: e.id,
      title: e.title,
      categoryName: e.categoryId ? categoryById.get(e.categoryId)?.name ?? null : null,
      directCost: e.directCost,
      durationMin,
      timeCost,
      hiddenCost: e.directCost + timeCost,
      date: parseDate(e.startAt),
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

// --- computeNetWorth ------------------------------------------------------------------------

export interface NetWorthReport {
  realAssetsValue: number;
  virtualAssetsValue: number;
  totalDebt: number;
  netWorth: number;
}

export function computeNetWorth(db: LocalDb, userId: string): NetWorthReport {
  const assets = db.all<{ currentValue: number }>(`SELECT "currentValue" FROM "Asset" WHERE "userId" = ? AND "deletedAt" IS NULL`, [userId]);
  const virtualAssetEntries = db.all<{ totalValue: number }>(`SELECT "totalValue" FROM "VirtualAssetEntry" WHERE "userId" = ?`, [userId]);
  const unpaidInstallments = db.all<{ amount: number }>(
    `SELECT i."amount" FROM "Installment" i
     JOIN "InstallmentPlan" p ON p."id" = i."planId"
     WHERE p."userId" = ? AND p."deletedAt" IS NULL AND i."status" != 'PAID'`,
    [userId]
  );

  const realAssetsValue = assets.reduce((s, a) => s + a.currentValue, 0);
  const virtualAssetsValue = virtualAssetEntries.reduce((s, e) => s + e.totalValue, 0);
  const totalDebt = unpaidInstallments.reduce((s, i) => s + i.amount, 0);

  return { realAssetsValue, virtualAssetsValue, totalDebt, netWorth: realAssetsValue + virtualAssetsValue - totalDebt };
}

// --- computeHabitsReport ---------------------------------------------------------------------

export interface HabitStat {
  id: string;
  title: string;
  icon: string | null;
  color: string;
  isActive: boolean;
  currentStreak: number;
  daysSinceLastCheckIn: number;
  virtualAssetValue: number;
}
export interface HabitsReport {
  habits: HabitStat[];
  series: DayAdherence[];
  currentStreak: number;
  digitalAssetTotal: number;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
const STREAK_LOOKBACK_DAYS = 60;

export function computeHabitsReport(db: LocalDb, userId: string, from: Date, to: Date): HabitsReport {
  const today = startOfDay(new Date());
  const streakFrom = new Date(today.getTime() - STREAK_LOOKBACK_DAYS * 86_400_000);
  const rangeFrom = startOfDay(from);
  const rangeTo = startOfDay(to) > today ? today : startOfDay(to);

  const habitRows = db.all<{ id: string; title: string; icon: string | null; color: string; isActive: number; createdAt: string }>(
    `SELECT "id","title","icon","color","isActive","createdAt" FROM "Habit" WHERE "userId" = ? AND "deletedAt" IS NULL AND "isTrial" = 0`,
    [userId]
  );
  const habits: HabitLike[] = habitRows.map((h) => ({ id: h.id, createdAt: parseDate(h.createdAt), isActive: !!h.isActive }));

  function checkInsInRange(fromD: Date, toD: Date): HabitCheckInLike[] {
    const rows = db.all<{ habitId: string; date: string }>(
      `SELECT hc."habitId", hc."date" FROM "HabitCheckIn" hc JOIN "Habit" h ON h."id" = hc."habitId"
       WHERE h."userId" = ? AND h."deletedAt" IS NULL AND h."isTrial" = 0 AND hc."date" >= ? AND hc."date" <= ?`,
      [userId, iso(fromD), iso(toD)]
    );
    return rows.map((r) => ({ habitId: r.habitId, date: parseDate(r.date) }));
  }

  const rangeCheckIns = checkInsInRange(rangeFrom, rangeTo);
  const streakCheckIns = checkInsInRange(streakFrom, today);

  const vaRows = db.all<{ totalValue: number; habitId: string }>(
    `SELECT vae."totalValue", hc."habitId" FROM "VirtualAssetEntry" vae
     JOIN "HabitCheckIn" hc ON hc."id" = vae."habitCheckInId"
     JOIN "Habit" h ON h."id" = hc."habitId"
     WHERE vae."userId" = ? AND vae."habitCheckInId" IS NOT NULL AND vae."date" >= ? AND vae."date" <= ? AND h."isTrial" = 0`,
    [userId, iso(from), iso(to)]
  );

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
  for (const e of vaRows) vaByHabit.set(e.habitId, (vaByHabit.get(e.habitId) ?? 0) + e.totalValue);

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
      title: habitRows.find((r) => r.id === h.id)!.title,
      icon: habitRows.find((r) => r.id === h.id)!.icon,
      color: habitRows.find((r) => r.id === h.id)!.color,
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
    digitalAssetTotal: vaRows.reduce((s, e) => s + e.totalValue, 0),
  };
}

// --- computeCategoryCalendar ------------------------------------------------------------------

export interface CategoryCalendarStat {
  categoryId: string;
  name: string;
  icon: string | null;
  color: string;
  totalMinutes: number;
  totalDays: number;
  days: Record<string, number>;
}

export function computeCategoryCalendar(db: LocalDb, userId: string, from: Date, to: Date): CategoryCalendarStat[] {
  const fromIso = iso(from);
  const toIso = iso(to);

  const categories = db.all<{ id: string; name: string; icon: string | null; color: string }>(
    `SELECT "id","name","icon","color" FROM "Category" WHERE "userId" = ? AND "deletedAt" IS NULL`,
    [userId]
  );
  const timeEntries = db.all<{ startAt: string; durationMin: number | null; categoryId: string | null }>(
    `SELECT te."startAt", te."durationMin", a."categoryId" FROM "TimeEntry" te JOIN "Activity" a ON a."id" = te."activityId"
     WHERE a."userId" = ? AND a."deletedAt" IS NULL AND te."startAt" >= ? AND te."startAt" <= ? AND te."durationMin" IS NOT NULL`,
    [userId, fromIso, toIso]
  );
  const tasks = db.all<{ categoryId: string | null; startAt: string; endAt: string }>(
    `SELECT "categoryId","startAt","endAt" FROM "Task" WHERE "userId" = ? AND "deletedAt" IS NULL AND "startAt" >= ? AND "startAt" <= ? AND "endAt" IS NOT NULL`,
    [userId, fromIso, toIso]
  );
  const completions = db.all<{ occurrenceDate: string; categoryId: string | null; eventStartAt: string; eventEndAt: string; eventAllDay: number }>(
    `SELECT ec."occurrenceDate", e."categoryId", e."startAt" as "eventStartAt", e."endAt" as "eventEndAt", e."allDay" as "eventAllDay"
     FROM "EventCompletion" ec JOIN "Event" e ON e."id" = ec."eventId"
     WHERE e."userId" = ? AND e."deletedAt" IS NULL AND ec."occurrenceDate" >= ? AND ec."occurrenceDate" <= ?`,
    [userId, fromIso, toIso]
  );
  const habitCheckIns = db.all<{ date: string; durationMin: number | null; categoryId: string | null }>(
    `SELECT hc."date", hc."durationMin", h."categoryId" FROM "HabitCheckIn" hc JOIN "Habit" h ON h."id" = hc."habitId"
     WHERE h."userId" = ? AND h."deletedAt" IS NULL AND hc."date" >= ? AND hc."date" <= ? AND hc."durationMin" IS NOT NULL`,
    [userId, fromIso, toIso]
  );

  const byCategory = new Map<string, Map<string, number>>();
  function addMinutes(categoryId: string | null, date: Date, minutes: number) {
    if (!categoryId || minutes <= 0) return;
    const key = dayKeyIso(date);
    if (!byCategory.has(categoryId)) byCategory.set(categoryId, new Map());
    const dayMap = byCategory.get(categoryId)!;
    dayMap.set(key, (dayMap.get(key) ?? 0) + minutes);
  }

  for (const te of timeEntries) addMinutes(te.categoryId, parseDate(te.startAt), te.durationMin ?? 0);
  for (const t of tasks) {
    const minutes = Math.max(0, Math.round((parseDate(t.endAt).getTime() - parseDate(t.startAt).getTime()) / 60000));
    addMinutes(t.categoryId, parseDate(t.startAt), minutes);
  }
  for (const c of completions) {
    if (c.eventAllDay) continue;
    const minutes = Math.max(0, Math.round((parseDate(c.eventEndAt).getTime() - parseDate(c.eventStartAt).getTime()) / 60000));
    addMinutes(c.categoryId, parseDate(c.occurrenceDate), minutes);
  }
  for (const checkIn of habitCheckIns) addMinutes(checkIn.categoryId, parseDate(checkIn.date), checkIn.durationMin ?? 0);

  return categories.map((cat) => {
    const dayMap = byCategory.get(cat.id) ?? new Map<string, number>();
    const days: Record<string, number> = {};
    let totalMinutes = 0;
    for (const [key, minutes] of dayMap) {
      days[key] = minutes;
      totalMinutes += minutes;
    }
    return { categoryId: cat.id, name: cat.name, icon: cat.icon, color: cat.color, totalMinutes, totalDays: dayMap.size, days };
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

/** Mirrors src/lib/reportEngine.ts's sumInvestedMinutes — see that file's doc comment for the
 * three-source rationale. `fromIso` omitted means lifetime. */
function sumInvestedMinutesLocal(db: LocalDb, userId: string, fromIso?: string): number {
  const productive = db.get<{ total: number | null }>(
    `SELECT SUM(te."durationMin") as total FROM "TimeEntry" te
     JOIN "Activity" a ON a."id" = te."activityId"
     JOIN "Category" c ON c."id" = a."categoryId"
     WHERE a."userId" = ? AND a."deletedAt" IS NULL AND c."kind" = 'PRODUCTIVE' AND te."durationMin" IS NOT NULL
     ${fromIso ? `AND te."startAt" >= ?` : ""}`,
    fromIso ? [userId, fromIso] : [userId]
  );
  const habits = db.get<{ total: number | null }>(
    `SELECT SUM(hc."durationMin") as total FROM "HabitCheckIn" hc JOIN "Habit" h ON h."id" = hc."habitId"
     WHERE h."userId" = ? AND h."deletedAt" IS NULL AND hc."durationMin" IS NOT NULL
     ${fromIso ? `AND hc."date" >= ?` : ""}`,
    fromIso ? [userId, fromIso] : [userId]
  );
  const projectTasks = db.all<{ startAt: string; endAt: string }>(
    `SELECT "startAt","endAt" FROM "Task"
     WHERE "userId" = ? AND "deletedAt" IS NULL AND "projectId" IS NOT NULL AND "startAt" IS NOT NULL AND "endAt" IS NOT NULL
     ${fromIso ? `AND "startAt" >= ?` : ""}`,
    fromIso ? [userId, fromIso] : [userId]
  );
  const taskMin = projectTasks.reduce((s, t) => s + Math.max(0, Math.round((parseDate(t.endAt).getTime() - parseDate(t.startAt).getTime()) / 60000)), 0);

  return (productive?.total ?? 0) + (habits?.total ?? 0) + taskMin;
}

/** On-device mirror of src/lib/reportEngine.ts's sumCategoryLifetimeMinutes — see its doc
 * comment for why this is TimeEntry-only, not the full timeByCategory source mix. */
export function sumCategoryLifetimeMinutes(db: LocalDb, userId: string, categoryId: string): number {
  const row = db.get<{ total: number | null }>(
    `SELECT SUM(te."durationMin") as total FROM "TimeEntry" te JOIN "Activity" a ON a."id" = te."activityId"
     WHERE a."userId" = ? AND a."deletedAt" IS NULL AND a."categoryId" = ? AND te."durationMin" IS NOT NULL`,
    [userId, categoryId]
  );
  return row?.total ?? 0;
}

export function computeFounderCapital(db: LocalDb, userId: string): FounderCapital {
  const now = new Date();
  const today = startOfDay(now);
  const { jy, jm } = toJalali(now);
  const monthStart = jalaliMonthRange(jy, jm).start;

  const investedMinutes = sumInvestedMinutesLocal(db, userId);
  const todayDeltaMinutes = sumInvestedMinutesLocal(db, userId, iso(today));
  const monthDeltaMinutes = sumInvestedMinutesLocal(db, userId, iso(monthStart));

  const vaRow = db.get<{ total: number | null }>(`SELECT SUM("totalValue") as total FROM "VirtualAssetEntry" WHERE "userId" = ?`, [userId]);
  const skillRow = db.get<{ n: number }>(`SELECT COUNT(DISTINCT "categoryId") as n FROM "VirtualAssetEntry" WHERE "userId" = ? AND "categoryId" IS NOT NULL`, [userId]);
  const projectRow = db.get<{ n: number }>(`SELECT COUNT(*) as n FROM "Project" WHERE "userId" = ? AND "deletedAt" IS NULL AND "status" = 'COMPLETED'`, [userId]);
  const assetRow = db.get<{ n: number }>(`SELECT COUNT(*) as n FROM "Asset" WHERE "userId" = ? AND "deletedAt" IS NULL`, [userId]);

  const firstActivity = db.get<{ createdAt: string | null }>(`SELECT MIN("createdAt") as "createdAt" FROM "Activity" WHERE "userId" = ? AND "deletedAt" IS NULL`, [userId]);
  const firstHabitCheckIn = db.get<{ createdAt: string | null }>(
    `SELECT MIN(hc."createdAt") as "createdAt" FROM "HabitCheckIn" hc JOIN "Habit" h ON h."id" = hc."habitId" WHERE h."userId" = ? AND h."deletedAt" IS NULL`,
    [userId]
  );
  const firstVirtualAsset = db.get<{ createdAt: string | null }>(`SELECT MIN("createdAt") as "createdAt" FROM "VirtualAssetEntry" WHERE "userId" = ?`, [userId]);
  const firstProjectTask = db.get<{ createdAt: string | null }>(
    `SELECT MIN("createdAt") as "createdAt" FROM "Task" WHERE "userId" = ? AND "deletedAt" IS NULL AND "projectId" IS NOT NULL`,
    [userId]
  );

  const firstDates = [firstActivity?.createdAt, firstHabitCheckIn?.createdAt, firstVirtualAsset?.createdAt, firstProjectTask?.createdAt]
    .filter((d): d is string => !!d)
    .map((d) => parseDate(d));
  const firstRecordAt = firstDates.length > 0 ? new Date(Math.min(...firstDates.map((d) => d.getTime()))) : null;

  return {
    investedMinutes,
    virtualAssetValue: vaRow?.total ?? 0,
    skillCount: skillRow?.n ?? 0,
    projectCount: projectRow?.n ?? 0,
    assetCount: assetRow?.n ?? 0,
    firstRecordAt,
    todayDeltaMinutes,
    monthDeltaMinutes,
  };
}

/** On-device mirror of src/lib/reportEngine.ts's recordDailyCapitalSnapshot — see its doc
 * comment for the idempotent-upsert rationale. */
export function recordDailyCapitalSnapshot(db: LocalDb, userId: string): FounderCapital {
  const capital = computeFounderCapital(db, userId);
  const date = jalaliDateKey(new Date());
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO "CapitalSnapshot" ("id","userId","date","investedMinutes","virtualAssetValue","createdAt")
     VALUES (?,?,?,?,?,?)
     ON CONFLICT("userId","date") DO UPDATE SET
       "investedMinutes" = excluded."investedMinutes",
       "virtualAssetValue" = excluded."virtualAssetValue"`,
    [crypto.randomUUID(), userId, date, capital.investedMinutes, capital.virtualAssetValue, now]
  );
  return capital;
}

// --- computeDayBattery ("DayBattery") -------------------------------------------------------

/** On-device mirror of src/lib/reportEngine.ts's computeDayBattery — see its doc comment for
 * why the source set differs from computeFounderCapital's (all categories, all tasks, no
 * project restriction; HabitCheckIn excluded — no real clock-time slot). */
export function computeDayBattery(db: LocalDb, userId: string): DayBatteryResult {
  const now = new Date();
  const settingsRow = db.get<{ wakeHour: number | null; sleepHour: number | null }>(`SELECT "wakeHour","sleepHour" FROM "Settings" WHERE "userId" = ?`, [userId]);
  const wakeHour = settingsRow?.wakeHour ?? 7;
  const sleepHour = settingsRow?.sleepHour ?? 23;
  const wakeTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), wakeHour, 0, 0, 0);
  const sleepTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sleepHour, 0, 0, 0);
  const wakeIso = iso(wakeTime);
  const sleepIso = iso(sleepTime);

  const timeEntryRows = db.all<{ startAt: string; endAt: string; kind: string | null }>(
    `SELECT te."startAt", te."endAt", c."kind" FROM "TimeEntry" te
     JOIN "Activity" a ON a."id" = te."activityId"
     LEFT JOIN "Category" c ON c."id" = a."categoryId"
     WHERE a."userId" = ? AND a."deletedAt" IS NULL AND te."startAt" >= ? AND te."startAt" < ? AND te."durationMin" IS NOT NULL`,
    [userId, wakeIso, sleepIso]
  );
  const taskRows = db.all<{ startAt: string; endAt: string; kind: string | null }>(
    `SELECT t."startAt", t."endAt", c."kind" FROM "Task" t
     LEFT JOIN "Category" c ON c."id" = t."categoryId"
     WHERE t."userId" = ? AND t."deletedAt" IS NULL AND t."startAt" >= ? AND t."startAt" < ? AND t."endAt" IS NOT NULL`,
    [userId, wakeIso, sleepIso]
  );
  const completionRows = db.all<{ eventStartAt: string; eventEndAt: string; eventAllDay: number; kind: string | null }>(
    `SELECT e."startAt" as "eventStartAt", e."endAt" as "eventEndAt", e."allDay" as "eventAllDay", c."kind"
     FROM "EventCompletion" ec JOIN "Event" e ON e."id" = ec."eventId"
     LEFT JOIN "Category" c ON c."id" = e."categoryId"
     WHERE e."userId" = ? AND e."deletedAt" IS NULL AND ec."occurrenceDate" >= ? AND ec."occurrenceDate" < ?`,
    [userId, wakeIso, sleepIso]
  );

  const intervals: TimedInterval[] = [
    ...timeEntryRows.map((r) => ({ start: parseDate(r.startAt), end: parseDate(r.endAt), kind: (r.kind ?? "NEUTRAL") as CategoryKindForBattery })),
    ...taskRows.map((r) => ({ start: parseDate(r.startAt), end: parseDate(r.endAt), kind: (r.kind ?? "NEUTRAL") as CategoryKindForBattery })),
    ...completionRows
      .filter((r) => !r.eventAllDay)
      .map((r) => ({ start: parseDate(r.eventStartAt), end: parseDate(r.eventEndAt), kind: (r.kind ?? "NEUTRAL") as CategoryKindForBattery })),
  ];

  return computeDaySegments(wakeTime, sleepTime, now, intervals);
}
