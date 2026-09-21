import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { searchAll } from "@/lib/searchData";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

const MAX_QUERY_LENGTH = 100;

// Search across everything the person keeps — tasks, events, daily notes, habits, categories,
// installment plans, transactions, projects, assets — each result carrying the facts worth reading
// in the list itself (see src/lib/searchEngine.ts) and the place tapping it should go.
async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, MAX_QUERY_LENGTH);
    if (!q) return NextResponse.json({ results: [] });
    return NextResponse.json({ results: await searchAll(userId, q) });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/search", GET);
export { loggedGET as GET };
