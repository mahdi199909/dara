import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { parseDayKey } from "@/lib/calendarGrid";
import { createSavingsGoalSchema } from "@/lib/schemas/savingsGoals";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

async function GET() {
  try {
    const userId = await requireUserId();
    const goals = await prisma.savingsGoal.findMany({
      where: { userId, deletedAt: null },
      include: { account: true },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ goals });
  } catch (err) {
    return handleApiError(err);
  }
}

async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = createSavingsGoalSchema.parse(await req.json());

    const account = await prisma.financeAccount.findFirst({ where: { id: body.accountId, userId, deletedAt: null } });
    if (!account) throw new ApiError("حساب پیدا نشد.", 404);

    const goal = await prisma.savingsGoal.create({
      data: {
        userId,
        title: body.title,
        targetAmount: body.targetAmount,
        targetDate: body.targetDate ? parseDayKey(body.targetDate) : null,
        accountId: body.accountId,
      },
      include: { account: true },
    });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "CREATE", entityType: "SavingsGoal", entityId: goal.id, newValue: goal, ipAddress, userAgent });

    return NextResponse.json({ goal }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/savings-goals", GET);
const loggedPOST = withApiLogging("POST", "/api/savings-goals", POST);
export { loggedGET as GET, loggedPOST as POST };
