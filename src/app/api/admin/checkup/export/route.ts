import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { handleApiError } from "@/lib/apiError";
import { EXPORT_COLUMNS, exportRows, loadCheckupRows, parseFilter } from "@/lib/checkupAdmin";
import { toCsv } from "@/lib/csv";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// Every answer sheet under the dashboard's current filter, as CSV. Holds respondents' contacts and free
// text: owner only, never cached, and toCsv neutralises cells that a spreadsheet would run as formulas.
async function GET(req: Request) {
  try {
    await requireAdmin();
    const { rows } = await loadCheckupRows(parseFilter(new URL(req.url).searchParams));
    const csv = toCsv(exportRows(rows), EXPORT_COLUMNS);
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="checkup-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/admin/checkup/export", GET);
export { loggedGET as GET };
