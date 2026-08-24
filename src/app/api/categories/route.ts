import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { CATEGORY_KINDS, VALUE_TYPES } from "@/lib/types";

const createSchema = z.object({
  name: z.string().min(1).max(50),
  icon: z.string().max(10).optional(),
  color: z.string().max(20).optional(),
  kind: z.enum(CATEGORY_KINDS).optional(),
  valueType: z.enum(VALUE_TYPES).optional(),
  generatesVirtualAsset: z.boolean().optional(),
  virtualAssetValuePerHour: z.number().int().min(0).optional(),
});

export async function GET() {
  try {
    const userId = await requireUserId();
    const categories = await prisma.category.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ categories });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = createSchema.parse(await req.json());

    const category = await prisma.category.create({
      data: { ...body, userId },
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
