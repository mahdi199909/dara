import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";

const schema = z.object({ accountId: z.string() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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

    const updated = await prisma.installment.update({
      where: { id: installment.id },
      data: { status: "PAID", paidAt: new Date() },
    });

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
