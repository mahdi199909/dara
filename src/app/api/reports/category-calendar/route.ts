import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { computeCategoryCalendar } from "@/lib/reportEngine";
import { jalaliMonthRange, toJalali } from "@/lib/jalali";
import { getLogger, startReport } from "@/lib/observability";
import { serverSettings } from "@/lib/observability/server/settings";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

const log = getLogger(null, "reports");

async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(req.url);
    const { jy: curJy, jm: curJm } = toJalali(new Date());
    const jy = Number(searchParams.get("jy") ?? curJy);
    const jm = Number(searchParams.get("jm") ?? curJm);
    const { start, end } = jalaliMonthRange(jy, jm);

    const run = startReport(log, "category_calendar", { from: start, to: end }, { slowMs: serverSettings().slowReportMs, layer: "server" });
    try {
      const categories = await computeCategoryCalendar(userId, start, end);
      run.completed(categories);
      return NextResponse.json({ categories, jy, jm });
    } catch (err) {
      run.failed(err);
      throw err;
    }
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/reports/category-calendar", GET);
export { loggedGET as GET };
