import { NextRequest, NextResponse } from "next/server";
import { getLogger } from "@/lib/observability";
import { logSessionInvalid } from "@/lib/observability/server/authEvents";
import { metricsAccess, renderMetrics, MIN_METRICS_TOKEN_LENGTH } from "@/lib/observability/server/metricsEndpoint";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// Prometheus text for a dashboard. Public in the middleware (a scraper has no session) and guarded here by its own
// bearer token, METRICS_TOKEN: unset means the endpoint does not exist. See doc/logging/operations.md.
const log = getLogger(null, "metrics");
let warnedWeakToken = false;

async function GET(req: NextRequest) {
  const access = metricsAccess(process.env, req.headers.get("authorization"));
  if (access === "disabled") return new NextResponse("Not found", { status: 404 });
  if (access === "weak-token") {
    if (!warnedWeakToken) {
      warnedWeakToken = true;
      log.warn("LOG_INTERNAL_ERROR", { message: `METRICS_TOKEN is shorter than ${MIN_METRICS_TOKEN_LENGTH} characters, so the metrics endpoint stays switched off` });
    }
    return new NextResponse("Not found", { status: 404 });
  }
  if (access === "unauthorized") {
    logSessionInvalid(req.headers.get("authorization") ? "invalid" : "missing");
    return new NextResponse("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  }
  return new NextResponse(renderMetrics(), { headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" } });
}

const loggedGET = withApiLogging("GET", "/api/metrics", GET);
export { loggedGET as GET };
