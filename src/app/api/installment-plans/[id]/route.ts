import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { summarizeInstallments, recomputeInstallmentDueDate } from "@/lib/installments";
import { updateInstallmentPlanSchema } from "@/lib/schemas/installments";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

async function getOwned(userId: string, id: string) {
  const plan = await prisma.installmentPlan.findFirst({
    where: { id, userId, deletedAt: null },
    include: { installments: { orderBy: { index: "asc" } } },
  });
  if (!plan) throw new ApiError("طرح قسط پیدا نشد.", 404);
  return plan;
}

async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const plan = await getOwned(userId, params.id);
    return NextResponse.json({ plan: { ...plan, summary: summarizeInstallments(plan.installments) } });
  } catch (err) {
    return handleApiError(err);
  }
}

async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
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

async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);
    // Explicit, caller-chosen cascade instead of an old hard 409 block that kept every plan
    // with any payment history around forever — see local repo's deleteInstallmentPlan for why.
    const deleteTransactions = new URL(req.url).searchParams.get("deleteTransactions") === "true";
    const ts = new Date();

    if (deleteTransactions && existing.installments.length > 0) {
      await prisma.transaction.updateMany({
        where: { installmentId: { in: existing.installments.map((i) => i.id) } },
        data: { deletedAt: ts },
      });
    }

    await prisma.installmentPlan.update({ where: { id: params.id }, data: { deletedAt: ts } });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "DELETE",
      entityType: "InstallmentPlan",
      entityId: params.id,
      oldValue: existing,
      metadata: { deleteTransactions },
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/installment-plans/[id]", GET);
const loggedPATCH = withApiLogging("PATCH", "/api/installment-plans/[id]", PATCH);
const loggedDELETE = withApiLogging("DELETE", "/api/installment-plans/[id]", DELETE);
export { loggedGET as GET, loggedPATCH as PATCH, loggedDELETE as DELETE };
