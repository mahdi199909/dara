// A habit's month, for «تقویم دسته‌بندی‌ها»: which days it was done, and what each day's tick logged — the habit's own
// measure (kilometres, pages, kilocalories) and the minutes it took, both optional. A habit that is only ticked still has
// its days; its month starts with how many. Pure, so the server engine, the on-device engine and the tab share one
// definition, and so it can be tested: the engines only load the rows.
import { dayKeyIso } from "./calendarGrid";
import { isMetricKind, type HabitMetricKind } from "./habitMetrics";

export interface HabitCalendarDay {
  /** The habit's own measure that day; null when none was written. */
  amount: number | null;
  /** The minutes it took; null when none were written. */
  minutes: number | null;
}

export interface HabitCalendarStat {
  habitId: string;
  title: string;
  icon: string | null;
  color: string;
  /** What the habit measures besides the tick; null = tick only. */
  metricKind: HabitMetricKind | null;
  isActive: boolean;
  /** "YYYY-MM-DD" → what that day's tick logged, only for days it was done. */
  days: Record<string, HabitCalendarDay>;
}

export interface HabitRowLike {
  id: string;
  title: string;
  icon: string | null;
  color: string;
  metricKind: string | null;
  isActive: boolean;
}

export interface CheckInRowLike {
  habitId: string;
  date: Date;
  durationMin: number | null;
  amount: number | null;
}

/**
 * One entry per habit worth listing for the month: an active habit (even before its first tick of the month, so the list
 * keeps its shape) or an inactive one that was done in it. The caller leaves out trial habits and habits that were deleted.
 */
export function buildHabitCalendar(habits: readonly HabitRowLike[], checkIns: readonly CheckInRowLike[]): HabitCalendarStat[] {
  const byHabit = new Map<string, Record<string, HabitCalendarDay>>();
  for (const c of checkIns) {
    const days = byHabit.get(c.habitId) ?? {};
    days[dayKeyIso(c.date)] = {
      amount: c.amount !== null && c.amount > 0 ? c.amount : null,
      minutes: c.durationMin !== null && c.durationMin > 0 ? c.durationMin : null,
    };
    byHabit.set(c.habitId, days);
  }
  return habits
    .filter((h) => h.isActive || (byHabit.get(h.id) && Object.keys(byHabit.get(h.id)!).length > 0))
    .map((h) => ({
      habitId: h.id,
      title: h.title,
      icon: h.icon,
      color: h.color,
      metricKind: isMetricKind(h.metricKind) ? h.metricKind : null,
      isActive: h.isActive,
      days: byHabit.get(h.id) ?? {},
    }));
}

export interface HabitMonthSummary {
  /** Days the habit was done. */
  daysDone: number;
  /** The measure added up, for a habit that has one. */
  totalAmount: number;
  /** Days that carry an amount (a tick without one still counts as done). */
  amountDays: number;
  totalMinutes: number;
  /** The day with the most of the measure; null when none was written. */
  best: { key: string; amount: number } | null;
}

export function summarizeHabitMonth(stat: Pick<HabitCalendarStat, "days">): HabitMonthSummary {
  let totalAmount = 0;
  let amountDays = 0;
  let totalMinutes = 0;
  let best: HabitMonthSummary["best"] = null;
  for (const [key, day] of Object.entries(stat.days)) {
    totalMinutes += day.minutes ?? 0;
    if (day.amount !== null) {
      totalAmount += day.amount;
      amountDays += 1;
      if (!best || day.amount > best.amount || (day.amount === best.amount && key < best.key)) best = { key, amount: day.amount };
    }
  }
  return { daysDone: Object.keys(stat.days).length, totalAmount, amountDays, totalMinutes, best };
}

/** The order of the habits in the list: those done this month first, the most days on top, then the rest by name. */
export function orderHabitsForList<T extends Pick<HabitCalendarStat, "title" | "days">>(stats: readonly T[]): T[] {
  return [...stats].sort((a, b) => {
    const aDays = Object.keys(a.days).length;
    const bDays = Object.keys(b.days).length;
    if ((aDays > 0) !== (bDays > 0)) return aDays > 0 ? -1 : 1;
    return bDays - aDays || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
  });
}

/** What a month's chart plots: the measure when days carry one, otherwise the minutes, otherwise nothing (a tick-only habit). */
export type ChartMetric = "amount" | "minutes";

export function chartMetric(stat: Pick<HabitCalendarStat, "days">): ChartMetric | null {
  const days = Object.values(stat.days);
  if (days.some((d) => d.amount !== null)) return "amount";
  if (days.some((d) => d.minutes !== null)) return "minutes";
  return null;
}

export interface ChartBar {
  key: string;
  /** The day of the month as it is written on the calendar. */
  label: number;
  value: number;
  /** 0..1 against the tallest bar. */
  height: number;
}

/** One bar for each given day (empty days are 0), scaled to the tallest. */
export function monthBars(stat: Pick<HabitCalendarStat, "days">, metric: ChartMetric, monthDays: ReadonlyArray<{ key: string; label: number }>): ChartBar[] {
  const values = monthDays.map(({ key, label }) => ({ key, label, value: stat.days[key]?.[metric === "amount" ? "amount" : "minutes"] ?? 0 }));
  const tallest = Math.max(0, ...values.map((v) => v.value));
  return values.map((v) => ({ ...v, height: tallest > 0 ? v.value / tallest : 0 }));
}
