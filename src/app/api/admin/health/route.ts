import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { handleApiError } from "@/lib/apiError";
import { buildHealthReport } from "@/lib/observability/server/healthReport";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// The owner's at-a-glance view of the running server: requests, error rate, latency, slow requests, database, sync,
// sign-in failures, jobs, reports, the log pipeline, and the last few problems. Counts and timings since the process
// started — never a person's data. See src/lib/observability/server/healthReport.ts.
async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(buildHealthReport(), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/admin/health", GET);
export { loggedGET as GET };
