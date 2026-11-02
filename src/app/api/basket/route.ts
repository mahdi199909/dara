import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { createBasketHoldingSchema } from "@/lib/schemas/basket";
import { createBasketHolding, listBasketHoldings } from "@/lib/basketServer";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ holdings: await listBasketHoldings(userId) });
  } catch (err) {
    return handleApiError(err);
  }
}

async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = createBasketHoldingSchema.parse(await req.json());
    const holding = await withTransaction(async () => createBasketHolding(userId, body), { operation: "BASKET_CREATE", entityType: "BasketHolding" });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "CREATE", entityType: "BasketHolding", entityId: holding.id, newValue: holding, ipAddress, userAgent });

    return NextResponse.json({ holding }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/basket", GET);
const loggedPOST = withApiLogging("POST", "/api/basket", POST);
export { loggedGET as GET, loggedPOST as POST };
