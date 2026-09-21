import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { summarizeInstallments, redateInstallments } from "@/lib/installments";
import { updateInstallmentPlanSchema } from "@/lib/schemas/installments";
import { parseDayKey } from "@/lib/calendarGrid";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

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

    // A new first date moves the whole schedule, which would rewrite dates that real payments
    // were made against — so it is only accepted while nothing is paid yet.
    if (body.firstDueDate !== undefined && existing.installments.some((i) => i.status === "PAID")) {
      throw new ApiError("بعد از پرداخت یک قسط، تاریخ اولین قسط قابل تغییر نیست. فقط روز سررسید اقساط باقی‌مانده را می‌توانید تغییر دهید.", 409);
    }
    const redating = redateInstallments({ installments: existing.installments, dueDay: body.dueDay, firstDueDate: body.firstDueDate });

    // The plan, the re-dated installments and their reminders commit together.
    const plan = await withTransaction(
      async () => {
        await prisma.installmentPlan.update({
          where: { id: params.id },
          data: {
            title: body.title,
            dueDay: redating?.dueDay,
            startDate: body.firstDueDate ? parseDayKey(body.firstDueDate) ?? undefined : undefined,
            notes: body.notes,
          },
        });

        // Only installments that haven't been paid yet are re-dated — PAID ones keep their real
        // historical due date so past reports/receipts stay accurate.
        for (const change of redating?.changes ?? []) {
          await prisma.installment.update({ where: { id: change.id }, data: { dueDate: change.dueDate } });
          // The reminders were set for the old date; move them with it (same as moving an event).
          const reminders = await prisma.reminder.findMany({ where: { installmentId: change.id } });
          for (const r of reminders) {
            await prisma.reminder.update({
              where: { id: r.id },
              data: { remindAt: new Date(change.dueDate.getTime() - r.offsetMinutes * 60000), notified: false },
            });
          }
        }

        const fresh = await getOwned(userId, params.id);
        const plan = { ...fresh, summary: summarizeInstallments(fresh.installments) };
        return plan;
      },
      { operation: "INSTALLMENT_UPDATE", entityType: "InstallmentPlan", entityId: params.id }
    );

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

    // Deleting the payments and the plan is one step.
    await withTransaction(
      async () => {
        if (deleteTransactions && existing.installments.length > 0) {
          await prisma.transaction.updateMany({
            where: { installmentId: { in: existing.installments.map((i) => i.id) } },
            data: { deletedAt: ts },
          });
        }

        await prisma.installmentPlan.update({ where: { id: params.id }, data: { deletedAt: ts } });
      },
      { operation: "INSTALLMENT_DELETE", entityType: "InstallmentPlan", entityId: params.id }
    );

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
