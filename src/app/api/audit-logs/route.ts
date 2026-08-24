import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(req.url);
    const entityType = searchParams.get("entityType");
    const limit = Math.min(Number(searchParams.get("limit") ?? 100), 300);

    const logs = await prisma.auditLog.findMany({
      where: { userId, ...(entityType ? { entityType } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({ logs });
  } catch (err) {
    return handleApiError(err);
  }
}
