import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { computeDayActivity } from "@/lib/reportEngine";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(req.url);
    const from = new Date(searchParams.get("from")!);
    const to = new Date(searchParams.get("to")!);
    const items = await computeDayActivity(userId, from, to);
    return NextResponse.json({ items });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/day-activity", GET);
export { loggedGET as GET };
