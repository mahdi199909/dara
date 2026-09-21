import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { planInstallments, summarizeInstallments } from "@/lib/installments";
import { createInstallmentPlanSchema } from "@/lib/schemas/installments";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

async function GET() {
  try {
    const userId = await requireUserId();
    const plans = await prisma.installmentPlan.findMany({
      where: { userId, deletedAt: null },
      include: { installments: { orderBy: { index: "asc" } } },
      orderBy: { createdAt: "desc" },
    });

    const withSummary = plans.map((plan) => ({
      ...plan,
      summary: summarizeInstallments(plan.installments),
    }));

    return NextResponse.json({ plans: withSummary });
  } catch (err) {
    return handleApiError(err);
  }
}

async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = createInstallmentPlanSchema.parse(await req.json());
    // Due dates are worked out on the Jalali calendar (see @/lib/installments); the phone runs the
    // very same function, so a plan reads the same wherever it was created.
    const { startDate, dueDay, schedule } = planInstallments(body);

    // The plan, all of its installments and their reminders are created together.
    const plan = await withTransaction(
      async () => {
        const plan = await prisma.installmentPlan.create({
          data: {
            userId,
            title: body.title,
            totalAmount: body.totalAmount,
            installmentAmount: body.installmentAmount,
            numberOfInstallments: body.numberOfInstallments,
            dueDay,
            startDate,
            notes: body.notes,
            installments: { create: schedule },
          },
          include: { installments: { orderBy: { index: "asc" } } },
        });

        if (body.reminderOffsets?.length) {
          for (const installment of plan.installments) {
            await prisma.reminder.createMany({
              data: body.reminderOffsets.map((offsetMinutes) => ({
                userId,
                targetType: "INSTALLMENT",
                installmentId: installment.id,
                title: `سررسید قسط: ${plan.title}`,
                offsetMinutes,
                remindAt: new Date(installment.dueDate.getTime() - offsetMinutes * 60000),
              })),
            });
          }
        }
        return plan;
      },
      { operation: "INSTALLMENT_CREATE", entityType: "InstallmentPlan" }
    );

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "CREATE",
      entityType: "InstallmentPlan",
      entityId: plan.id,
      newValue: plan,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ plan: { ...plan, summary: summarizeInstallments(plan.installments) } }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/installment-plans", GET);
const loggedPOST = withApiLogging("POST", "/api/installment-plans", POST);
export { loggedGET as GET, loggedPOST as POST };
