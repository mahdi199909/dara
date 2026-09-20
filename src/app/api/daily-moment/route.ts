import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { computeDailyMomentCandidates } from "@/lib/insightsData";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

async function GET() {
  try {
    const userId = await requireUserId();
    const candidates = await computeDailyMomentCandidates(userId);
    return NextResponse.json({ candidates });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/daily-moment", GET);
export { loggedGET as GET };
