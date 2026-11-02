// What a habit can measure besides the tick. Everything here is optional: a habit may be only ticked, or ticked with
// the minutes it took, or ticked with its own measure as well — kilometres for a run, pages for a book, kilocalories
// for a workout. The kinds are few on purpose: the ones a total and a chart make sense for. Minutes are not a kind;
// any habit can log them (HabitCheckIn.durationMin).
import { formatDuration, toAsciiDigits, toPersianDigits } from "./money";

export const HABIT_METRIC_KINDS = ["DISTANCE", "PAGES", "CALORIES"] as const;
export type HabitMetricKind = (typeof HABIT_METRIC_KINDS)[number];

export interface HabitMetricInfo {
  /** What it is called in a list of choices. */
  label: string;
  /** The unit written after a number. */
  unit: string;
  /** The question over the box a person types the number in. */
  question: string;
  /** Digits after the decimal point worth showing. */
  decimals: number;
}

export const HABIT_METRICS: Record<HabitMetricKind, HabitMetricInfo> = {
  DISTANCE: { label: "مسافت (کیلومتر)", unit: "کیلومتر", question: "چند کیلومتر؟", decimals: 1 },
  PAGES: { label: "تعداد صفحه", unit: "صفحه", question: "چند صفحه؟", decimals: 0 },
  CALORIES: { label: "کالری سوزانده‌شده", unit: "کیلوکالری", question: "چند کیلوکالری؟", decimals: 0 },
};

export function isMetricKind(value: unknown): value is HabitMetricKind {
  return typeof value === "string" && (HABIT_METRIC_KINDS as readonly string[]).includes(value);
}

/** A number as it is written here: Persian digits, and a Persian decimal point only when there is a fraction to show. */
export function formatNumber(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(decimals).replace(/\.?0+$/, "");
  return toPersianDigits(text.replace(".", "٫"));
}

/** «۵٫۲ کیلومتر», «۳۰ صفحه», «۴۵۰ کیلوکالری». */
export function formatAmount(kind: HabitMetricKind, amount: number): string {
  const info = HABIT_METRICS[kind];
  return `${formatNumber(amount, info.decimals)} ${info.unit}`;
}

/**
 * What a person typed in an amount box: Persian, Arabic or Latin digits, and a Persian, Arabic or ordinary decimal
 * point (or a comma). Null for nothing, for text that is not a number, and for a number that is not above zero.
 */
export function parseAmount(text: string): number | null {
  const cleaned = toAsciiDigits(text)
    .trim()
    .replace(/[٬\s]/g, "")
    .replace(/[٫,،]/g, ".");
  if (!/^\d+(\.\d+)?$/.test(cleaned) && !/^\.\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** What a day's check-in says for itself — «۵ کیلومتر · ۳۰ دقیقه» — or null when nothing but the tick was logged. */
export function describeDay(kind: HabitMetricKind | null | undefined, amount: number | null | undefined, minutes: number | null | undefined): string | null {
  const parts: string[] = [];
  if (kind && amount && amount > 0) parts.push(formatAmount(kind, amount));
  if (minutes && minutes > 0) parts.push(formatDuration(minutes));
  return parts.length > 0 ? parts.join(" · ") : null;
}
