import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { loadJourneyRows } from "@/lib/journeyData";
import { journeyQuerySchema } from "@/lib/schemas/journey";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// «مسیر» — the facts of a stretch of days (events, done tasks, tracked work, habit check-ins, notes, project
// landmarks) for the story page to turn into prose. The wording is done on the client (src/lib/journeyEngine.ts),
// so the same words come out on the web and on the phone.
async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const params = new URL(req.url).searchParams;
    const query = journeyQuerySchema.parse({ from: params.get("from") ?? undefined, to: params.get("to") ?? undefined });
    return NextResponse.json(await loadJourneyRows(userId, new Date(query.from), new Date(query.to)));
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/journey", GET);
export { loggedGET as GET };
