import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { recordBasketSnapshotSchema } from "@/lib/schemas/basket";
import { recordBasketSnapshot } from "@/lib/basketServer";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// Records today's value of the basket for the chart. Like CapitalSnapshot this is the app keeping its own history, not
// something the person edits, so it leaves no entry in the activity history.
async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = recordBasketSnapshotSchema.parse(await req.json());
    return NextResponse.json(await recordBasketSnapshot(userId, body.prices));
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedPOST = withApiLogging("POST", "/api/basket/snapshot", POST);
export { loggedPOST as POST };
