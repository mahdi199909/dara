import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { updateBasketHoldingSchema } from "@/lib/schemas/basket";
import { deleteBasketHolding, getOwnedBasketHolding, updateBasketHolding } from "@/lib/basketServer";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const userId = await requireUserId();
    const existing = await getOwnedBasketHolding(userId, params.id);
    const body = updateBasketHoldingSchema.parse(await req.json());
    const holding = await withTransaction(async () => updateBasketHolding(userId, params.id, body), { operation: "BASKET_UPDATE", entityType: "BasketHolding", entityId: params.id });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "UPDATE", entityType: "BasketHolding", entityId: params.id, oldValue: existing, newValue: holding, ipAddress, userAgent });

    return NextResponse.json({ holding });
  } catch (err) {
    return handleApiError(err);
  }
}

async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const userId = await requireUserId();
    const existing = await getOwnedBasketHolding(userId, params.id);
    const result = await withTransaction(async () => deleteBasketHolding(userId, params.id), { operation: "BASKET_DELETE", entityType: "BasketHolding", entityId: params.id });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "DELETE", entityType: "BasketHolding", entityId: params.id, oldValue: existing, ipAddress, userAgent });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedPATCH = withApiLogging("PATCH", "/api/basket/[id]", PATCH);
const loggedDELETE = withApiLogging("DELETE", "/api/basket/[id]", DELETE);
export { loggedPATCH as PATCH, loggedDELETE as DELETE };
