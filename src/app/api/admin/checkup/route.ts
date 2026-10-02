import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { handleApiError } from "@/lib/apiError";
import { checkupDashboard, parseFilter } from "@/lib/checkupAdmin";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// The owner's view of the research form (/dashboard/checkup). Percentages are withheld below 80 completed
// answers by computeCheckupMetrics itself, so no client can show one by accident.
async function GET(req: Request) {
  try {
    await requireAdmin();
    const filter = parseFilter(new URL(req.url).searchParams);
    return NextResponse.json(await checkupDashboard(filter), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/admin/checkup", GET);
export { loggedGET as GET };
