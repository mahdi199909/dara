import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { generateInstallmentSchedule, summarizeInstallments } from "@/lib/installments";

const createSchema = z.object({
  title: z.string().min(1).max(150),
  totalAmount: z.number().int().positive(),
  installmentAmount: z.number().int().positive(),
  numberOfInstallments: z.number().int().positive().max(360),
  dueDay: z.number().int().min(1).max(31),
  startDate: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
  reminderOffsets: z.array(z.number().int().min(0)).optional(),
});

export async function GET() {
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

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = createSchema.parse(await req.json());
    const startDate = body.startDate ? new Date(body.startDate) : new Date();

    const schedule = generateInstallmentSchedule({
      startDate,
      dueDay: body.dueDay,
      numberOfInstallments: body.numberOfInstallments,
      installmentAmount: body.installmentAmount,
    });

    const plan = await prisma.installmentPlan.create({
      data: {
        userId,
        title: body.title,
        totalAmount: body.totalAmount,
        installmentAmount: body.installmentAmount,
        numberOfInstallments: body.numberOfInstallments,
        dueDay: body.dueDay,
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
