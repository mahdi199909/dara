import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { handleApiError, ApiError } from "@/lib/apiError";
import { userDetail } from "@/lib/adminUsers";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    await requireAdmin();
    const detail = await userDetail(params.id);
    if (!detail) throw new ApiError("کاربر پیدا نشد.", 404);
    return NextResponse.json(detail, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/admin/users/[id]", GET);
export { loggedGET as GET };
