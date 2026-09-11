import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { summarizeInstallments, recomputeInstallmentDueDate } from "@/lib/installments";
import { updateInstallmentPlanSchema } from "@/lib/schemas/installments";

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

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);
    const body = updateInstallmentPlanSchema.parse(await req.json());

    await prisma.installmentPlan.update({
      where: { id: params.id },
      data: {
        title: body.title,
        dueDay: body.dueDay,
        notes: body.notes,
      },
    });

    // Re-date only installments that haven't been paid yet — PAID ones keep their real
    // historical due date so past reports/receipts stay accurate.
    if (body.dueDay !== undefined && body.dueDay !== existing.dueDay) {
      for (const installment of existing.installments) {
        if (installment.status === "PAID") continue;
        const dueDate = recomputeInstallmentDueDate(existing.startDate, body.dueDay, installment.index);
        await prisma.installment.update({ where: { id: installment.id }, data: { dueDate } });
      }
    }

    const fresh = await getOwned(userId, params.id);
    const plan = { ...fresh, summary: summarizeInstallments(fresh.installments) };

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "UPDATE",
      entityType: "InstallmentPlan",
      entityId: params.id,
      oldValue: existing,
      newValue: plan,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ plan });
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
