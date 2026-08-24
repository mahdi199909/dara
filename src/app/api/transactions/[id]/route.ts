import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";

const updateSchema = z.object({
  amount: z.number().int().positive().optional(),
  date: z.string().datetime().optional(),
  description: z.string().max(500).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
});

async function getOwned(userId: string, id: string) {
  const tx = await prisma.transaction.findFirst({ where: { id, userId, deletedAt: null } });
  if (!tx) throw new ApiError("تراکنش پیدا نشد.", 404);
  return tx;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);
    if (existing.installmentId) throw new ApiError("تراکنش‌های مرتبط با قسط از این مسیر قابل ویرایش نیستند.", 409);

    const body = updateSchema.parse(await req.json());
    const transaction = await prisma.transaction.update({
      where: { id: params.id },
      data: { ...body, date: body.date ? new Date(body.date) : undefined },
    });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "UPDATE",
      entityType: "Transaction",
      entityId: transaction.id,
      oldValue: existing,
      newValue: transaction,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ transaction });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);
    if (existing.installmentId) throw new ApiError("تراکنش‌های مرتبط با قسط از این مسیر قابل حذف نیستند.", 409);

    await prisma.transaction.update({ where: { id: params.id }, data: { deletedAt: new Date() } });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "DELETE",
      entityType: "Transaction",
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
