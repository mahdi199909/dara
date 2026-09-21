import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { tomanInt } from "@/lib/schemas/money";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { CATEGORY_KINDS, VALUE_TYPES } from "@/lib/types";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

const updateSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  icon: z.string().max(10).optional(),
  color: z.string().max(20).optional(),
  kind: z.enum(CATEGORY_KINDS).optional(),
  valueType: z.enum(VALUE_TYPES).optional(),
  isActive: z.boolean().optional(),
  generatesVirtualAsset: z.boolean().optional(),
  virtualAssetValuePerHour: tomanInt().min(0).nullable().optional(),
  parentCategoryId: z.string().min(1).nullable().optional(),
});

async function getOwned(userId: string, id: string) {
  const category = await prisma.category.findFirst({ where: { id, userId, deletedAt: null } });
  if (!category) throw new ApiError("دسته‌بندی پیدا نشد.", 404);
  return category;
}

async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);
    const body = updateSchema.parse(await req.json());

    if (body.parentCategoryId) {
      if (body.parentCategoryId === params.id) throw new ApiError("یک دسته‌بندی نمی‌تواند والدِ خودش باشد.", 422);
      const parent = await prisma.category.findFirst({ where: { id: body.parentCategoryId, userId, deletedAt: null } });
      if (!parent) throw new ApiError("دسته‌بندی والد پیدا نشد.", 404);
      if (parent.parentCategoryId) throw new ApiError("یک زیردسته نمی‌تواند خودش والدِ دسته‌ی دیگری باشد.", 422);
      // One level only (see prisma/schema.prisma) — a category that already has its own
      // sub-categories can't itself become someone else's child, or the hierarchy would end up
      // two levels deep. Not just a drag-and-drop UI concern: without this check here, any PATCH
      // caller could create that invalid state.
      const existingChild = await prisma.category.findFirst({ where: { parentCategoryId: params.id, userId, deletedAt: null } });
      if (existingChild) throw new ApiError("این دسته‌بندی خودش زیردسته دارد و نمی‌تواند زیرِ دسته‌ی دیگری قرار بگیرد.", 422);
    }

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

async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);

    await withTransaction(
      async () => {
        await prisma.category.update({ where: { id: params.id }, data: { deletedAt: new Date() } });
        // The schema's onDelete: SetNull for parentCategoryId only fires on a real row DELETE, never
        // on this soft-delete UPDATE — without this, a sub-category of this one would keep pointing
        // at a now-deleted parent forever (same fix as the on-device repository's deleteCategory).
        await prisma.category.updateMany({ where: { parentCategoryId: params.id, userId }, data: { parentCategoryId: null } });
      },
      { operation: "CATEGORY_DELETE", entityType: "Category", entityId: params.id }
    );

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

const loggedPATCH = withApiLogging("PATCH", "/api/categories/[id]", PATCH);
const loggedDELETE = withApiLogging("DELETE", "/api/categories/[id]", DELETE);
export { loggedPATCH as PATCH, loggedDELETE as DELETE };
