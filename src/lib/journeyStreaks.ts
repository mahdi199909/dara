// «This was the seventh day in a row» — how many consecutive days one habit had been done, up to each day it was.
// Pure, and shared by the two data loaders (web: src/lib/journeyData.ts, phone: src/local/journeyData.ts) so a streak
// means the same thing on both. It is per habit and counts only that habit's own check-ins; the app-wide streak
// (src/lib/habitStreak.ts, "80% of the day's habits") is a different idea and is not used here.
import { dayKeyIso, parseDayKey } from "./calendarGrid";

/** "YYYY-MM-DD" of the calendar day before `key`. Done with date fields (not by subtracting 24 hours) so a daylight-saving change cannot skip or repeat a day. */
function previousDayKey(key: string): string | null {
  const day = parseDayKey(key);
  if (!day) return null;
  return dayKeyIso(new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1));
}

/** The whole-day number of a "YYYY-MM-DD" key, counted in UTC so a daylight-saving change cannot make two neighbours 23 or 25 hours apart. */
function dayNumber(key: string): number | null {
  const day = parseDayKey(key);
  return day ? Math.round(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86_400_000) : null;
}

/**
 * For every distinct day in `dayKeys` that is not the first: how many days were skipped just before it — 0 for the day
 * after a done day, 3 when it came back after three days away. The first day has no entry (it did not come back from
 * anything). The other half of a streak: where `streakByDay` counts the days in a row, this counts the days between.
 */
export function missedDaysBefore(dayKeys: readonly string[]): Map<string, number> {
  const unique = [...new Set(dayKeys)].sort();
  const missed = new Map<string, number>();
  for (let i = 1; i < unique.length; i++) {
    const a = dayNumber(unique[i - 1]);
    const b = dayNumber(unique[i]);
    if (a !== null && b !== null) missed.set(unique[i], Math.max(0, b - a - 1));
  }
  return missed;
}

/**
 * For every distinct day in `dayKeys` ("YYYY-MM-DD", any order, duplicates ignored), the length of the run of
 * consecutive days that ends on it: 1 for a day whose previous day was not done, 2 for the day after that, and so on.
 */
export function streakByDay(dayKeys: readonly string[]): Map<string, number> {
  const unique = [...new Set(dayKeys)].sort();
  const streaks = new Map<string, number>();
  for (const key of unique) {
    const previous = previousDayKey(key);
    streaks.set(key, previous !== null && streaks.has(previous) ? streaks.get(previous)! + 1 : 1);
  }
  return streaks;
}
