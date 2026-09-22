import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { parseDayKey } from "@/lib/calendarGrid";
import { updateSavingsGoalSchema } from "@/lib/schemas/savingsGoals";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

async function getOwned(userId: string, id: string) {
  const goal = await prisma.savingsGoal.findFirst({ where: { id, userId, deletedAt: null } });
  if (!goal) throw new ApiError("هدف پیدا نشد.", 404);
  return goal;
}

async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);
    const body = updateSavingsGoalSchema.parse(await req.json());

    if (body.accountId) {
      const account = await prisma.financeAccount.findFirst({ where: { id: body.accountId, userId, deletedAt: null } });
      if (!account) throw new ApiError("حساب پیدا نشد.", 404);
    }

    const goal = await prisma.savingsGoal.update({
      where: { id: params.id },
      data: {
        title: body.title,
        targetAmount: body.targetAmount,
        targetDate: body.targetDate === undefined ? undefined : body.targetDate ? parseDayKey(body.targetDate) : null,
        accountId: body.accountId,
      },
      include: { account: true },
    });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "UPDATE", entityType: "SavingsGoal", entityId: goal.id, oldValue: existing, newValue: goal, ipAddress, userAgent });

    return NextResponse.json({ goal });
  } catch (err) {
    return handleApiError(err);
  }
}

async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);

    await prisma.savingsGoal.update({ where: { id: params.id }, data: { deletedAt: new Date() } });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "DELETE", entityType: "SavingsGoal", entityId: params.id, oldValue: existing, ipAddress, userAgent });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedPATCH = withApiLogging("PATCH", "/api/savings-goals/[id]", PATCH);
const loggedDELETE = withApiLogging("DELETE", "/api/savings-goals/[id]", DELETE);
export { loggedPATCH as PATCH, loggedDELETE as DELETE };
