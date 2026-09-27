import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { handleApiError } from "@/lib/apiError";
import { adminStats } from "@/lib/adminUsers";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(await adminStats(), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/admin/stats", GET);
export { loggedGET as GET };
