import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

const schema = z.object({ accountId: z.string() });

async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const installment = await prisma.installment.findFirst({
      where: { id: params.id, plan: { userId, deletedAt: null } },
      include: { plan: true },
    });
    if (!installment) throw new ApiError("قسط پیدا نشد.", 404);
    if (installment.status === "PAID") throw new ApiError("این قسط قبلاً پرداخت شده است.", 409);

    const { accountId } = schema.parse(await req.json());
    const account = await prisma.financeAccount.findFirst({ where: { id: accountId, userId, deletedAt: null } });
    if (!account) throw new ApiError("حساب پیدا نشد.", 404);

    // Exactly once. The installment is flipped from unpaid to paid by a conditional update, and the
    // expense is created in the same transaction: the request that wins the flip writes the payment, one
    // that lost the race is refused (409) and writes nothing, and a failure between the two steps leaves
    // neither — never an expense without a paid installment, never two expenses for one installment.
    const { transaction, updated } = await withTransaction(
      async () => {
        const claimed = await prisma.installment.updateMany({
          where: { id: installment.id, status: { not: "PAID" } },
          data: { status: "PAID", paidAt: new Date() },
        });
        if (claimed.count === 0) throw new ApiError("این قسط قبلاً پرداخت شده است.", 409);

        const transaction = await prisma.transaction.create({
          data: {
            userId,
            type: "EXPENSE",
            amount: installment.amount,
            date: new Date(),
            description: `پرداخت قسط ${installment.index} از ${installment.plan.title}`,
            accountId,
            installmentId: installment.id,
          },
        });
        const updated = await prisma.installment.findUniqueOrThrow({ where: { id: installment.id } });
        return { transaction, updated };
      },
      { operation: "INSTALLMENT_PAY", entityType: "Installment", entityId: installment.id }
    );

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "PAYMENT",
      entityType: "Installment",
      entityId: installment.id,
      oldValue: installment,
      newValue: updated,
      metadata: { transactionId: transaction.id },
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ installment: updated, transaction });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedPOST = withApiLogging("POST", "/api/installments/[id]/pay", POST);
export { loggedPOST as POST };
