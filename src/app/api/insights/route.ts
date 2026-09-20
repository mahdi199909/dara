import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { computeDailyInsight } from "@/lib/insightsData";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

async function GET() {
  try {
    const userId = await requireUserId();
    const insight = await computeDailyInsight(userId);
    return NextResponse.json({ insight });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/insights", GET);
export { loggedGET as GET };
