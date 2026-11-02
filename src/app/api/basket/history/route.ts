import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { basketRangeSchema } from "@/lib/schemas/basket";
import { listBasketPoints } from "@/lib/basketServer";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// The value-over-time chart: one point per day the person's basket was priced, for the last month, the last year or
// everything recorded.
async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const range = basketRangeSchema.parse(new URL(req.url).searchParams.get("range") ?? undefined);
    return NextResponse.json({ range, points: await listBasketPoints(userId, range) });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/basket/history", GET);
export { loggedGET as GET };
