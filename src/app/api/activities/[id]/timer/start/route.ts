import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { startTimer } from "@/lib/activityService";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const activity = await prisma.activity.findFirst({ where: { id: params.id, userId, deletedAt: null } });
    if (!activity) throw new ApiError("فعالیت پیدا نشد.", 404);

    const timeEntry = await startTimer(userId, params.id);

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "TIMER_START",
      entityType: "Activity",
      entityId: params.id,
      newValue: timeEntry,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ timeEntry });
  } catch (err) {
    return handleApiError(err);
  }
}
