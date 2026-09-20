// Shared by both the web route (src/app/api/reports/route.ts) and the local dispatcher
// (src/lib/localDispatcher.ts) — pure date math with no Next.js/Prisma dependency, so it's
// safe to bundle into the Android build too (see apiErrorBase.ts's own doc comment for why
// that boundary matters). Keeping this in one place means "what does the ‘این ماه’ preset
// actually mean" can't drift between the two implementations the way a copy-pasted version
// eventually would.
import { ApiError } from "./apiErrorBase";
import { formatJalali, jalaliMonthRange, toJalali } from "./jalali";
import { toPersianDigits } from "./money";

export interface ResolvedRange {
  from: Date;
  to: Date;
  label: string;
}

export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/** The longest custom range a report is computed for — every report walks the whole range's rows. */
export const MAX_CUSTOM_RANGE_DAYS = 3660;

/** Why a custom range can't be used, in words for the person picking it — or null when it's fine. */
export function validateCustomRange(from: Date, to: Date): string | null {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return "تاریخ‌های بازه معتبر نیست.";
  if (startOfDay(from).getTime() > endOfDay(to).getTime()) return "تاریخ شروع باید قبل از تاریخ پایان باشد.";
  const days = (endOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000;
  if (days > MAX_CUSTOM_RANGE_DAYS) return `بازه‌ی گزارش حداکثر ۱۰ سال می‌تواند باشد.`;
  return null;
}

/** The query string that asks for a custom range: exact instants (whole local days), so the server never has to guess which time zone a bare date meant. */
export function customRangeQuery(from: Date, to: Date): string {
  return `from=${encodeURIComponent(startOfDay(from).toISOString())}&to=${encodeURIComponent(endOfDay(to).toISOString())}`;
}

/** Turns a Reports preset (or an explicit from/to pair) into a concrete date range + label. */
export function resolveRange(preset: string | null, from: string | null, to: string | null): ResolvedRange {
  const now = new Date();

  switch (preset) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now), label: "امروز" };
    case "week": {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      return { from: startOfDay(start), to: endOfDay(now), label: "این هفته" };
    }
    case "month": {
      const { jy, jm } = toJalali(now);
      const { start, end } = jalaliMonthRange(jy, jm);
      return { from: start, to: end, label: "این ماه" };
    }
    case "lastMonth": {
      const { jy, jm } = toJalali(now);
      const prevJm = jm === 1 ? 12 : jm - 1;
      const prevJy = jm === 1 ? jy - 1 : jy;
      const { start, end } = jalaliMonthRange(prevJy, prevJm);
      return { from: start, to: end, label: "ماه گذشته" };
    }
    case "year": {
      const { jy } = toJalali(now);
      const { start } = jalaliMonthRange(jy, 1);
      const { end } = jalaliMonthRange(jy, 12);
      return { from: start, to: end, label: `سال ${toPersianDigits(jy)}` };
    }
    default: {
      if (!from || !to) throw new ApiError("بازه زمانی نامعتبر است.", 400);
      const start = new Date(from);
      // A bare date ("2026-09-10") means the whole of that day; a full timestamp (what the app
      // sends — see customRangeQuery) is the exact end of the range and is used as it is.
      const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? endOfDay(new Date(to)) : new Date(to);
      const problem = validateCustomRange(start, end);
      if (problem) throw new ApiError(problem, 400);
      return { from: start, to: end, label: `${formatJalali(start)} تا ${formatJalali(end)}` };
    }
  }
}
