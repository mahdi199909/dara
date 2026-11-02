// The «تقویم دسته‌بندی‌ها» tab's arithmetic, kept out of the component so it can be tested: ordering the
// categories for the list beside the calendar, adding them all up into the «همهٔ دسته‌ها» view the tab opens
// on, and the month's headline numbers. The data is what /api/reports/category-calendar answers: per category,
// the minutes of each day and the items behind them.

export interface CategoryCalendarItem {
  type: "TIME_ENTRY" | "TASK" | "EVENT" | "HABIT";
  title: string;
  minutes: number;
  /** ISO datetime when the item has a real time of day; null for a habit check-in. */
  timeOfDay: string | null;
}

export interface CategoryCalendarStat {
  categoryId: string;
  name: string;
  icon: string | null;
  color: string;
  parentCategoryId: string | null;
  totalMinutes: number;
  totalDays: number;
  /** "YYYY-MM-DD" → minutes, only for days with some. */
  days: Record<string, number>;
  dayItems: Record<string, CategoryCalendarItem[]>;
}

/** A day-list item of the merged view, which also says which category it belongs to. */
export interface MergedCategoryItem extends CategoryCalendarItem {
  category: { name: string; icon: string | null };
}

export interface MergedCategoryStat extends Omit<CategoryCalendarStat, "dayItems"> {
  dayItems: Record<string, MergedCategoryItem[]>;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The order the categories are listed in: those with time this month first, the busiest on top, then the ones with
 * none (in name order, so they do not jump around). Returns a new array.
 */
export function orderForList<T extends Pick<CategoryCalendarStat, "name" | "totalMinutes">>(stats: readonly T[]): T[] {
  return [...stats].sort((a, b) => {
    const aActive = a.totalMinutes > 0;
    const bActive = b.totalMinutes > 0;
    if (aActive !== bActive) return aActive ? -1 : 1;
    return b.totalMinutes - a.totalMinutes || compareText(a.name, b.name);
  });
}

/**
 * Every category added together: the minutes of each day across all of them, and every item of the day with the
 * category it came from. `totalDays` counts the days with anything at all (not the sum of the categories' own day
 * counts, which would count a day once per category).
 */
export function mergeCategoryStats(stats: readonly CategoryCalendarStat[], label: { name: string; icon: string | null; color: string }): MergedCategoryStat {
  const days: Record<string, number> = {};
  const dayItems: Record<string, MergedCategoryItem[]> = {};
  let totalMinutes = 0;
  for (const stat of stats) {
    totalMinutes += stat.totalMinutes;
    for (const [key, minutes] of Object.entries(stat.days)) days[key] = (days[key] ?? 0) + minutes;
    for (const [key, items] of Object.entries(stat.dayItems)) {
      const bucket = (dayItems[key] ??= []);
      for (const item of items) bucket.push({ ...item, category: { name: stat.name, icon: stat.icon } });
    }
  }
  // Timed items first, earliest first; items with no time of day after them (a habit check-in), in the order met.
  for (const items of Object.values(dayItems)) {
    items.sort((a, b) => (a.timeOfDay && b.timeOfDay ? compareText(a.timeOfDay, b.timeOfDay) : a.timeOfDay ? -1 : b.timeOfDay ? 1 : 0));
  }
  return {
    categoryId: "all",
    name: label.name,
    icon: label.icon,
    color: label.color,
    parentCategoryId: null,
    totalMinutes,
    totalDays: Object.keys(days).length,
    days,
    dayItems,
  };
}

export interface MonthHeadline {
  totalMinutes: number;
  activeDays: number;
  /** The category with the most time, or null when none has any. */
  busiest: CategoryCalendarStat | null;
}

export function monthHeadline(stats: readonly CategoryCalendarStat[]): MonthHeadline {
  const merged = mergeCategoryStats(stats, { name: "", icon: null, color: "" });
  const busiest = orderForList(stats).find((stat) => stat.totalMinutes > 0) ?? null;
  return { totalMinutes: merged.totalMinutes, activeDays: merged.totalDays, busiest };
}

/** How much of a heat scale a day fills, 0..1 — against the busiest day shown. */
export function heatOf(minutes: number, busiestDayMinutes: number): number {
  if (minutes <= 0) return 0;
  return Math.min(1, minutes / Math.max(1, busiestDayMinutes));
}
