import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { tomanInt } from "@/lib/schemas/money";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { CATEGORY_KINDS, VALUE_TYPES } from "@/lib/types";

const createSchema = z.object({
  name: z.string().min(1).max(50),
  icon: z.string().max(10).optional(),
  color: z.string().max(20).optional(),
  kind: z.enum(CATEGORY_KINDS).optional(),
  valueType: z.enum(VALUE_TYPES).optional(),
  generatesVirtualAsset: z.boolean().optional(),
  virtualAssetValuePerHour: tomanInt().min(0).optional(),
  parentCategoryId: z.string().min(1).nullable().optional(),
});

export async function GET() {
  try {
    const userId = await requireUserId();
    const categories = await prisma.category.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ categories });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const { parentCategoryId, ...body } = createSchema.parse(await req.json());

    if (parentCategoryId) {
      const parent = await prisma.category.findFirst({ where: { id: parentCategoryId, userId, deletedAt: null } });
      if (!parent) throw new ApiError("دسته‌بندی والد پیدا نشد.", 404);
      if (parent.parentCategoryId) throw new ApiError("یک زیردسته نمی‌تواند خودش والدِ دسته‌ی دیگری باشد.", 422);
    }

    // New categories join at the end of the user's own order, not at sortOrder 0 alongside
    // whatever an un-reordered account already has sitting there — same reasoning as the
    // on-device repository's identical computation (src/local/repositories/categories.ts).
    const last = await prisma.category.findFirst({ where: { userId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    const sortOrder = (last?.sortOrder ?? -1) + 1;

    const category = await prisma.category.create({
      data: { ...body, userId, sortOrder, parentCategoryId: parentCategoryId ?? undefined },
    });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "CREATE",
      entityType: "Category",
      entityId: category.id,
      newValue: category,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ category }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
