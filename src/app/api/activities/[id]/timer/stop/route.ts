import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { stopTimer } from "@/lib/activityService";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const activity = await prisma.activity.findFirst({ where: { id: params.id, userId, deletedAt: null } });
    if (!activity) throw new ApiError("فعالیت پیدا نشد.", 404);

    const timeEntry = await stopTimer(params.id);
    if (!timeEntry) throw new ApiError("تایمر فعالی برای این فعالیت وجود ندارد.", 400);

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "TIMER_STOP",
      entityType: "Activity",
      entityId: params.id,
      newValue: timeEntry,
      ipAddress,
      userAgent,
    });

    const fresh = await prisma.activity.findUnique({ where: { id: params.id } });
    return NextResponse.json({ timeEntry, activity: fresh });
  } catch (err) {
    return handleApiError(err);
  }
}
