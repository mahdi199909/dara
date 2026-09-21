import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { computeTimeAndMoneyReport, computeNetWorth, computeHiddenCostReport, computeHabitsReport, sumCategoryLifetimeMinutes, comparePeriods } from "@/lib/reportEngine";
import { generateNarrative } from "@/lib/narrative";
import { resolveRange } from "@/lib/reportRange";
import { getLogger, startReport } from "@/lib/observability";
import { serverSettings } from "@/lib/observability/server/settings";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// No fixed module: the REPORT_* events belong to the report domain, whichever file writes them.
const log = getLogger(null, "reports");

async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(req.url);
    const { from, to, label } = resolveRange(
      searchParams.get("preset"),
      searchParams.get("from"),
      searchParams.get("to")
    );

    // How long it took, over which period and how many rows — never a figure (see reportRun.ts).
    const run = startReport(log, "time_and_money", { from, to }, { slowMs: serverSettings().slowReportMs, layer: "server" });
    try {
      const [report, netWorth, hiddenCost, habitsReport, comparison] = await Promise.all([
        computeTimeAndMoneyReport(userId, from, to),
        computeNetWorth(userId),
        computeHiddenCostReport(userId, from, to),
        computeHabitsReport(userId, from, to),
        comparePeriods(userId, from, to),
      ]);

      const topProductive = [...report.timeByCategory].filter((c) => c.kind === "PRODUCTIVE").sort((a, b) => b.minutes - a.minutes)[0];
      const topCategoryLifetimeMinutes = topProductive ? await sumCategoryLifetimeMinutes(userId, topProductive.categoryId) : 0;
      const narrative = generateNarrative(report, hiddenCost, topCategoryLifetimeMinutes);

      const body = { report, netWorth, hiddenCost, habitsReport, comparison, narrative, label, from, to };
      run.completed(body);
      return NextResponse.json(body);
    } catch (err) {
      run.failed(err);
      throw err;
    }
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/reports", GET);
export { loggedGET as GET };
