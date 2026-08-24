import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { syncHabitCheckInVirtualAsset } from "@/lib/habitSync";

const bodySchema = z.object({ date: z.string().datetime().optional() });

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Toggles the check-in for a habit on a given day (defaults to today). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const habit = await prisma.habit.findFirst({ where: { id: params.id, userId, deletedAt: null } });
    if (!habit) throw new ApiError("عادت پیدا نشد.", 404);

    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const date = startOfDay(body.date ? new Date(body.date) : new Date());

    const existing = await prisma.habitCheckIn.findUnique({
      where: { habitId_date: { habitId: habit.id, date } },
    });

    const { ipAddress, userAgent } = requestMeta(req);

    if (existing) {
      await prisma.virtualAssetEntry.deleteMany({ where: { habitCheckInId: existing.id } });
      await prisma.habitCheckIn.delete({ where: { id: existing.id } });
      await writeAuditLog({
        userId,
        action: "HABIT_UNCHECK",
        entityType: "HabitCheckIn",
        entityId: existing.id,
        oldValue: existing,
        ipAddress,
        userAgent,
      });
      return NextResponse.json({ checkedIn: false });
    }

    const checkIn = await prisma.habitCheckIn.create({ data: { habitId: habit.id, date } });
    await syncHabitCheckInVirtualAsset(checkIn.id);
    await writeAuditLog({
      userId,
      action: "HABIT_CHECKIN",
      entityType: "HabitCheckIn",
      entityId: checkIn.id,
      newValue: checkIn,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ checkedIn: true });
  } catch (err) {
    return handleApiError(err);
  }
}
