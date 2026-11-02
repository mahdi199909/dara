// The athlete mode's calorie meter: the meals a person writes down for a day, the day's total against the daily target
// they chose, and a week at a glance. Everything is kept on this device (src/lib/deviceStore.ts) and nothing here judges:
// the meter says how much is left, or how much is over, and that is all. Pure, so it can be tested.
import { dayKeyIso, parseDayKey } from "./calendarGrid";

export const MEAL_KINDS = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;
export type MealKind = (typeof MEAL_KINDS)[number];
export const MEAL_KIND_LABELS: Record<MealKind, string> = { BREAKFAST: "صبحانه", LUNCH: "ناهار", DINNER: "شام", SNACK: "میان‌وعده" };

export interface MealEntry {
  id: string;
  /** The calendar day, "YYYY-MM-DD" in local time. */
  day: string;
  kind: MealKind;
  title: string;
  /** Kilocalories, a whole number. */
  kcal: number;
}

export interface MealData {
  v: 1;
  /** The daily target in kilocalories; null until the person sets one. */
  target: number | null;
  entries: MealEntry[];
}

export const EMPTY_MEALS: MealData = { v: 1, target: null, entries: [] };
export const MEALS_STORAGE_KEY = "parva.meals.v1";

export const MAX_KCAL = 10_000;
export const MIN_TARGET = 500;
export const MAX_TARGET = 10_000;

/** What a meal needs to be written down, or the reason it cannot be (in the person's words). */
export function validateMeal(input: { title: string; kcal: number; kind: string }): string | null {
  if (!input.title.trim()) return "اسم غذا را بنویس.";
  if (input.title.trim().length > 100) return "اسم غذا از ۱۰۰ نویسه بلندتر است.";
  if (!(MEAL_KINDS as readonly string[]).includes(input.kind)) return "وعده را انتخاب کن.";
  if (!Number.isFinite(input.kcal) || !Number.isInteger(input.kcal) || input.kcal < 1 || input.kcal > MAX_KCAL) return `کالری را به‌صورت عدد صحیح بین ۱ تا ${MAX_KCAL.toLocaleString("fa-IR")} بنویس.`;
  return null;
}

export function validateTarget(target: number): string | null {
  if (!Number.isInteger(target) || target < MIN_TARGET || target > MAX_TARGET) return `هدف روزانه را بین ${MIN_TARGET.toLocaleString("fa-IR")} تا ${MAX_TARGET.toLocaleString("fa-IR")} کیلوکالری بنویس.`;
  return null;
}

/** A value read back from storage, made safe: anything that is not a well-formed entry is dropped rather than trusted. */
export function sanitizeMeals(raw: unknown): MealData {
  if (!raw || typeof raw !== "object") return EMPTY_MEALS;
  const data = raw as { target?: unknown; entries?: unknown };
  const target = typeof data.target === "number" && validateTarget(data.target) === null ? data.target : null;
  const entries = Array.isArray(data.entries)
    ? data.entries.filter(
        (e): e is MealEntry =>
          !!e &&
          typeof e === "object" &&
          typeof (e as MealEntry).id === "string" &&
          typeof (e as MealEntry).day === "string" &&
          parseDayKey((e as MealEntry).day) !== null &&
          (MEAL_KINDS as readonly string[]).includes((e as MealEntry).kind) &&
          typeof (e as MealEntry).title === "string" &&
          validateMeal({ title: (e as MealEntry).title, kcal: (e as MealEntry).kcal, kind: (e as MealEntry).kind }) === null
      )
    : [];
  return { v: 1, target, entries };
}

export function addMeal(data: MealData, entry: MealEntry): MealData {
  return { ...data, entries: [...data.entries, entry] };
}

export function updateMeal(data: MealData, id: string, patch: Partial<Pick<MealEntry, "kind" | "title" | "kcal" | "day">>): MealData {
  return { ...data, entries: data.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
}

export function removeMeal(data: MealData, id: string): MealData {
  return { ...data, entries: data.entries.filter((e) => e.id !== id) };
}

export function setTarget(data: MealData, target: number | null): MealData {
  return { ...data, target };
}

export function mealsOfDay(data: MealData, day: string): MealEntry[] {
  const order = new Map(MEAL_KINDS.map((kind, i) => [kind, i]));
  return data.entries
    .filter((e) => e.day === day)
    .map((e, index) => ({ e, index }))
    // By meal of the day, then in the order they were written.
    .sort((a, b) => (order.get(a.e.kind)! - order.get(b.e.kind)!) || a.index - b.index)
    .map(({ e }) => e);
}

export function dayTotal(data: MealData, day: string): number {
  return data.entries.reduce((sum, e) => (e.day === day ? sum + e.kcal : sum), 0);
}

export type MeterState = "NO_TARGET" | "UNDER" | "REACHED" | "OVER";

export interface Meter {
  state: MeterState;
  total: number;
  target: number | null;
  /** How much of the target the total is, 0..1 for the bar (a total past the target fills it). */
  fill: number;
  /** Kilocalories left to the target; null without one. Negative when past it. */
  remaining: number | null;
}

export function meterOf(total: number, target: number | null): Meter {
  if (target === null) return { state: "NO_TARGET", total, target, fill: 0, remaining: null };
  const remaining = target - total;
  return { state: total > target ? "OVER" : total === target ? "REACHED" : "UNDER", total, target, fill: Math.max(0, Math.min(1, total / target)), remaining };
}

/** The meter's sentence — plain, never a scolding. */
export function meterSentence(meter: Meter, toPersian: (n: number) => string): string {
  switch (meter.state) {
    case "NO_TARGET":
      return "هدفی نگذاشته‌ای؛ فقط جمع کالری‌های امروز را می‌بینی.";
    case "UNDER":
      return `${toPersian(meter.remaining!)} کیلوکالری تا هدف مانده است.`;
    case "REACHED":
      return "به هدف روزانه رسیدی.";
    case "OVER":
      return `${toPersian(-meter.remaining!)} کیلوکالری بیشتر از هدف.`;
  }
}

export interface DayBar {
  day: string;
  total: number;
  /** 0..1 against the tallest of the days shown (and the target, when it is taller). */
  height: number;
}

/** The totals of the `count` days ending with `endDay`, oldest first, scaled together. */
export function lastDays(data: MealData, endDay: string, count: number): DayBar[] {
  const end = parseDayKey(endDay) ?? new Date();
  const days = Array.from({ length: count }, (_, i) => dayKeyIso(new Date(end.getFullYear(), end.getMonth(), end.getDate() - (count - 1 - i))));
  const totals = days.map((day) => ({ day, total: dayTotal(data, day) }));
  const tallest = Math.max(data.target ?? 0, ...totals.map((t) => t.total));
  return totals.map((t) => ({ ...t, height: tallest > 0 ? t.total / tallest : 0 }));
}

export interface MealSuggestion {
  title: string;
  kind: MealKind;
  kcal: number;
}

/**
 * Meals the person has written before, most often first (the latest calories and meal of each), to write one again in
 * a tap. A title counts case-insensitively and without surrounding spaces.
 */
export function suggestions(data: MealData, limit = 6): MealSuggestion[] {
  const byTitle = new Map<string, { count: number; last: MealEntry }>();
  for (const e of data.entries) {
    const key = e.title.trim().toLowerCase();
    const seen = byTitle.get(key);
    byTitle.set(key, { count: (seen?.count ?? 0) + 1, last: !seen || e.day >= seen.last.day ? e : seen.last });
  }
  return [...byTitle.values()]
    .sort((a, b) => b.count - a.count || (b.last.day < a.last.day ? -1 : b.last.day > a.last.day ? 1 : 0))
    .slice(0, limit)
    .map(({ last }) => ({ title: last.title.trim(), kind: last.kind, kcal: last.kcal }));
}

/** What a habit that measures burned kilocalories logged for a day, from the day-activity rows (information beside the meter, never subtracted from it). */
export function burnedFromHabits(rows: ReadonlyArray<{ type?: string; habitMetricKind?: string | null; habitAmount?: number | null }> | undefined): number {
  return (rows ?? []).reduce((sum, r) => (r.type === "HABIT" && r.habitMetricKind === "CALORIES" && r.habitAmount ? sum + r.habitAmount : sum), 0);
}
