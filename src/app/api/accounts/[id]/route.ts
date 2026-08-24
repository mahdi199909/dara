import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { ACCOUNT_TYPES } from "@/lib/types";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(ACCOUNT_TYPES).optional(),
  isActive: z.boolean().optional(),
});

async function getOwned(userId: string, id: string) {
  const account = await prisma.financeAccount.findFirst({ where: { id, userId, deletedAt: null } });
  if (!account) throw new ApiError("حساب پیدا نشد.", 404);
  return account;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);
    const body = updateSchema.parse(await req.json());

    const account = await prisma.financeAccount.update({ where: { id: params.id }, data: body });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "UPDATE",
      entityType: "FinanceAccount",
      entityId: account.id,
      oldValue: existing,
      newValue: account,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ account });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);

    const txCount = await prisma.transaction.count({ where: { accountId: params.id, deletedAt: null } });
    if (txCount > 0) {
      throw new ApiError("این حساب دارای تراکنش است و نمی‌تواند حذف شود؛ آن را غیرفعال کنید.", 409);
    }

    await prisma.financeAccount.update({ where: { id: params.id }, data: { deletedAt: new Date() } });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "DELETE",
      entityType: "FinanceAccount",
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
