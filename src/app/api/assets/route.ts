import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";

const createSchema = z.object({
  name: z.string().min(1).max(150),
  category: z.string().max(50).optional(),
  purchasePrice: z.number().int().min(0),
  purchaseDate: z.string().datetime().optional(),
  currentValue: z.number().int().min(0).optional(),
  notes: z.string().max(1000).optional(),
});

export async function GET() {
  try {
    const userId = await requireUserId();
    const assets = await prisma.asset.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ assets });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = createSchema.parse(await req.json());

    const asset = await prisma.asset.create({
      data: {
        userId,
        name: body.name,
        category: body.category,
        purchasePrice: body.purchasePrice,
        purchaseDate: body.purchaseDate ? new Date(body.purchaseDate) : new Date(),
        currentValue: body.currentValue ?? body.purchasePrice,
        notes: body.notes,
      },
    });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "CREATE",
      entityType: "Asset",
      entityId: asset.id,
      newValue: asset,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
