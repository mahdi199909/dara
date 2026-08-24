import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { summarizeInstallments } from "@/lib/installments";

async function getOwned(userId: string, id: string) {
  const plan = await prisma.installmentPlan.findFirst({
    where: { id, userId, deletedAt: null },
    include: { installments: { orderBy: { index: "asc" } } },
  });
  if (!plan) throw new ApiError("طرح قسط پیدا نشد.", 404);
  return plan;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const plan = await getOwned(userId, params.id);
    return NextResponse.json({ plan: { ...plan, summary: summarizeInstallments(plan.installments) } });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);

    const paidCount = existing.installments.filter((i) => i.status === "PAID").length;
    if (paidCount > 0) {
      throw new ApiError("طرحی که پرداخت انجام‌شده دارد قابل حذف نیست تا صحت گزارش‌ها حفظ شود.", 409);
    }

    await prisma.installmentPlan.update({ where: { id: params.id }, data: { deletedAt: new Date() } });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "DELETE",
      entityType: "InstallmentPlan",
      entityId: params.id,
      oldValue: existing,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
