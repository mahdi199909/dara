import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { computeTimeAndMoneyReport, computeNetWorth, computeHiddenCostReport, computeHabitsReport } from "@/lib/reportEngine";
import { generateNarrative } from "@/lib/narrative";
import { formatJalali, jalaliMonthRange, toJalali } from "@/lib/jalali";

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function resolveRange(preset: string | null, from: string | null, to: string | null) {
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
      return { from: start, to: end, label: `سال ${jy}` };
    }
    default: {
      if (!from || !to) throw new ApiError("بازه زمانی نامعتبر است.", 400);
      const start = new Date(from);
      const end = endOfDay(new Date(to));
      return { from: start, to: end, label: `${formatJalali(start)} تا ${formatJalali(end)}` };
    }
  }
}

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(req.url);
    const { from, to, label } = resolveRange(
      searchParams.get("preset"),
      searchParams.get("from"),
      searchParams.get("to")
    );

    const [report, netWorth, hiddenCost, habitsReport] = await Promise.all([
      computeTimeAndMoneyReport(userId, from, to),
      computeNetWorth(userId),
      computeHiddenCostReport(userId, from, to),
      computeHabitsReport(userId, from, to),
    ]);

    const narrative = generateNarrative(report, label);

    return NextResponse.json({ report, netWorth, hiddenCost, habitsReport, narrative, label, from, to });
  } catch (err) {
    return handleApiError(err);
  }
}
