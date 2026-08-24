import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { CATEGORY_KINDS, VALUE_TYPES } from "@/lib/types";

const updateSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  icon: z.string().max(10).optional(),
  color: z.string().max(20).optional(),
  kind: z.enum(CATEGORY_KINDS).optional(),
  valueType: z.enum(VALUE_TYPES).optional(),
  isActive: z.boolean().optional(),
  generatesVirtualAsset: z.boolean().optional(),
  virtualAssetValuePerHour: z.number().int().min(0).nullable().optional(),
});

async function getOwned(userId: string, id: string) {
  const category = await prisma.category.findFirst({ where: { id, userId, deletedAt: null } });
  if (!category) throw new ApiError("دسته‌بندی پیدا نشد.", 404);
  return category;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);
    const body = updateSchema.parse(await req.json());

    const category = await prisma.category.update({ where: { id: params.id }, data: body });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "UPDATE",
      entityType: "Category",
      entityId: category.id,
      oldValue: existing,
      newValue: category,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ category });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);

    await prisma.category.update({ where: { id: params.id }, data: { deletedAt: new Date() } });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "DELETE",
      entityType: "Category",
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
