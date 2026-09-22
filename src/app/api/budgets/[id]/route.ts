import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

async function getOwned(userId: string, id: string) {
  const budget = await prisma.budget.findFirst({ where: { id, userId, deletedAt: null } });
  if (!budget) throw new ApiError("بودجه پیدا نشد.", 404);
  return budget;
}

async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);

    await withTransaction(
      async () => prisma.budget.update({ where: { id: params.id }, data: { deletedAt: new Date() } }),
      { operation: "BUDGET_DELETE", entityType: "Budget", entityId: params.id }
    );

    const { ipAddress, userAgent } = requestMeta(_req);
    await writeAuditLog({ userId, action: "DELETE", entityType: "Budget", entityId: params.id, oldValue: existing, ipAddress, userAgent });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedDELETE = withApiLogging("DELETE", "/api/budgets/:id", DELETE);
export { loggedDELETE as DELETE };
