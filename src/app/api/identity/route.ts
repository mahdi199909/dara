import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { computeIdentityStatements } from "@/lib/identityData";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

async function GET() {
  try {
    const userId = await requireUserId();
    const statements = await computeIdentityStatements(userId);
    return NextResponse.json({ statements });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/identity", GET);
export { loggedGET as GET };
