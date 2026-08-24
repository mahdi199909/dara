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

const durationBodySchema = z.object({
  date: z.string().datetime().optional(),
  durationMin: z.number().int().min(0).max(1440),
});

/**
 * Sets (or clears, with durationMin: 0) how long the user spent on a habit that day —
 * separate from the POST toggle above so checking in stays a single, frictionless tap;
 * logging time is an optional follow-up action. Implicitly checks the day in if it wasn't
 * already (a duration only makes sense for a day the habit was actually done), and re-syncs
 * the day's virtual asset value, which now factors the duration in — see habitSync.ts.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const habit = await prisma.habit.findFirst({ where: { id: params.id, userId, deletedAt: null } });
    if (!habit) throw new ApiError("عادت پیدا نشد.", 404);

    const body = durationBodySchema.parse(await req.json());
    const date = startOfDay(body.date ? new Date(body.date) : new Date());

    const existing = await prisma.habitCheckIn.findUnique({
      where: { habitId_date: { habitId: habit.id, date } },
    });

    const { ipAddress, userAgent } = requestMeta(req);
    const durationMin = body.durationMin > 0 ? body.durationMin : null;

    const checkIn = existing
      ? await prisma.habitCheckIn.update({ where: { id: existing.id }, data: { durationMin } })
      : await prisma.habitCheckIn.create({ data: { habitId: habit.id, date, durationMin } });

    await syncHabitCheckInVirtualAsset(checkIn.id);
    await writeAuditLog({
      userId,
      action: "HABIT_LOG_DURATION",
      entityType: "HabitCheckIn",
      entityId: checkIn.id,
      oldValue: existing,
      newValue: checkIn,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ checkIn });
  } catch (err) {
    return handleApiError(err);
  }
}
