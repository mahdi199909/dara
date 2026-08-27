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

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
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
      const end = endOfDay(new Date(to));
      return { from: start, to: end, label: `${formatJalali(start)} تا ${formatJalali(end)}` };
    }
  }
}
