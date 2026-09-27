import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { handleApiError } from "@/lib/apiError";
import { listUsers } from "@/lib/adminUsers";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// Every account with its subscription, for /dashboard's user table.
const querySchema = z.object({
  q: z.string().max(100).optional(),
  filter: z.enum(["all", "trial", "subscribed", "lifetime", "free", "expiring", "disabled", "unverified"]).optional(),
  sort: z.enum(["created", "lastSeen", "expiry", "name"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const query = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    return NextResponse.json(await listUsers(query), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/admin/users", GET);
export { loggedGET as GET };
