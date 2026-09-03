import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { computeTimeAndMoneyReport, computeNetWorth, computeHiddenCostReport, computeHabitsReport, sumCategoryLifetimeMinutes } from "@/lib/reportEngine";
import { generateNarrative } from "@/lib/narrative";
import { resolveRange } from "@/lib/reportRange";

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

    const topProductive = [...report.timeByCategory].filter((c) => c.kind === "PRODUCTIVE").sort((a, b) => b.minutes - a.minutes)[0];
    const topCategoryLifetimeMinutes = topProductive ? await sumCategoryLifetimeMinutes(userId, topProductive.categoryId) : 0;
    const narrative = generateNarrative(report, hiddenCost, topCategoryLifetimeMinutes);

    return NextResponse.json({ report, netWorth, hiddenCost, habitsReport, narrative, label, from, to });
  } catch (err) {
    return handleApiError(err);
  }
}
