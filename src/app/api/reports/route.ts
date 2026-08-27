import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { computeTimeAndMoneyReport, computeNetWorth, computeHiddenCostReport, computeHabitsReport } from "@/lib/reportEngine";
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

    const narrative = generateNarrative(report, label);

    return NextResponse.json({ report, netWorth, hiddenCost, habitsReport, narrative, label, from, to });
  } catch (err) {
    return handleApiError(err);
  }
}
