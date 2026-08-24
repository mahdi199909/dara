import { fromJalali, jalaliMonthRange } from "./jalali";

/** Builds a full-week (Saturday-first, Persian week) grid of Gregorian Dates covering a Jalali month. */
export function getJalaliMonthGrid(jy: number, jm: number): Date[] {
  const { start, end } = jalaliMonthRange(jy, jm);

  const gridStart = new Date(start);
  const daysSinceSaturday = (gridStart.getDay() + 1) % 7; // Saturday=6 -> 0, Sunday=0 -> 1, ... Friday=5 -> 6
  gridStart.setDate(gridStart.getDate() - daysSinceSaturday);

  const gridEnd = new Date(end);
  const daysUntilFriday = (5 - gridEnd.getDay() + 7) % 7;
  gridEnd.setDate(gridEnd.getDate() + daysUntilFriday);

  const days: Date[] = [];
  const cur = new Date(gridStart);
  while (cur <= gridEnd) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "YYYY-MM-DD" (local, Gregorian) — the shared key used to match a calendar grid cell
 * against server-aggregated per-day data (see computeCategoryCalendar in reportEngine.ts).
 * Both sides import this one function so a day is bucketed identically everywhere. */
export function dayKeyIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addJalaliMonths(jy: number, jm: number, delta: number): { jy: number; jm: number } {
  let total = jm - 1 + delta;
  let newJy = jy + Math.floor(total / 12);
  let newJm = (total % 12 + 12) % 12 + 1;
  return { jy: newJy, jm: newJm };
}

export { fromJalali };
