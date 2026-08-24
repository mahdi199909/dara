import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { TRANSACTION_TYPES } from "@/lib/types";

const createSchema = z.object({
  type: z.enum(TRANSACTION_TYPES),
  amount: z.number().int().positive(),
  date: z.string().datetime().optional(),
  description: z.string().max(500).optional(),
  accountId: z.string(),
  transferToAccountId: z.string().optional(),
  categoryId: z.string().optional(),
  taskId: z.string().optional(),
  projectId: z.string().optional(),
  assetId: z.string().optional(),
  activityId: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const type = searchParams.get("type");
    const accountId = searchParams.get("accountId");
    const limit = Math.min(Number(searchParams.get("limit") ?? 100), 500);

    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        ...(type ? { type } : {}),
        ...(accountId ? { accountId } : {}),
        ...(from || to
          ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
          : {}),
      },
      include: { category: true, account: true, project: true, task: true, asset: true },
      orderBy: { date: "desc" },
      take: limit,
    });

    return NextResponse.json({ transactions });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = createSchema.parse(await req.json());

    const account = await prisma.financeAccount.findFirst({ where: { id: body.accountId, userId, deletedAt: null } });
    if (!account) throw new ApiError("حساب مبدا پیدا نشد.", 404);

    if (body.type === "TRANSFER") {
      if (!body.transferToAccountId) throw new ApiError("حساب مقصد برای انتقال الزامی است.", 400);
      const dest = await prisma.financeAccount.findFirst({
        where: { id: body.transferToAccountId, userId, deletedAt: null },
      });
      if (!dest) throw new ApiError("حساب مقصد پیدا نشد.", 404);
    }

    const transaction = await prisma.transaction.create({
      data: {
        userId,
        type: body.type,
        amount: body.amount,
        date: body.date ? new Date(body.date) : new Date(),
        description: body.description,
        accountId: body.accountId,
        transferToAccountId: body.type === "TRANSFER" ? body.transferToAccountId : undefined,
        categoryId: body.categoryId,
        taskId: body.taskId,
        projectId: body.projectId,
        assetId: body.assetId,
        activityId: body.activityId,
      },
    });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: body.type === "INCOME" ? "CREATE_INCOME" : body.type === "EXPENSE" ? "CREATE_EXPENSE" : "CREATE_TRANSFER",
      entityType: "Transaction",
      entityId: transaction.id,
      newValue: transaction,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ transaction }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
