import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { computeAdherenceSeries, computeCurrentStreak, daysSinceLastCheckIn, trialDayNumber, isTrialElapsed } from "@/lib/habitStreak";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  icon: z.string().max(8).nullable().optional(),
  color: z.string().max(20).optional(),
  categoryId: z.string().nullable().optional(),
  virtualAssetValuePerCheckIn: z.number().int().min(0).optional(),
  // BJ Fogg "Tiny Habits" trial — see the isTrial doc comment on the Habit model.
  isTrial: z.boolean().optional(),
  cue: z.string().max(300).nullable().optional(),
  celebration: z.string().max(300).nullable().optional(),
});

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Returns every active habit together with today's check-in state, its current streak, and
 * a 30-day adherence series — everything Home and the Reports "عادت‌ها" tab need in one call.
 */
export async function GET() {
  try {
    const userId = await requireUserId();
    const today = startOfDay(new Date());
    const seriesFrom = new Date(today.getTime() - 29 * 86_400_000);

    const habits = await prisma.habit.findMany({
      where: { userId, deletedAt: null },
      include: { category: true },
      orderBy: { createdAt: "asc" },
    });

    const checkIns = await prisma.habitCheckIn.findMany({
      where: { habit: { userId, deletedAt: null }, date: { gte: seriesFrom, lte: today } },
    });

    const series = computeAdherenceSeries(habits, checkIns, seriesFrom, today);
    const currentStreak = computeCurrentStreak(series, today);

    const checkedInTodaySet = new Set(
      checkIns.filter((c) => c.date.getTime() === today.getTime()).map((c) => c.habitId)
    );

    const habitsWithState = habits.map((h) => ({
      ...h,
      checkedInToday: checkedInTodaySet.has(h.id),
      daysSinceLastCheckIn: daysSinceLastCheckIn(
        checkIns.filter((c) => c.habitId === h.id),
        h.createdAt,
        today
      ),
      trialDayNumber: h.isTrial && h.trialStartDate ? trialDayNumber(h.trialStartDate, today) : null,
      trialElapsed: h.isTrial && h.trialStartDate ? isTrialElapsed(h.trialStartDate, today) : null,
    }));

    return NextResponse.json({ habits: habitsWithState, series, currentStreak });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = createSchema.parse(await req.json());

    const habit = await prisma.habit.create({
      data: {
        userId,
        title: body.title,
        description: body.description,
        icon: body.icon,
        color: body.color,
        categoryId: body.categoryId,
        virtualAssetValuePerCheckIn: body.virtualAssetValuePerCheckIn ?? 0,
        isTrial: body.isTrial ?? false,
        cue: body.cue,
        celebration: body.celebration,
        trialStartDate: body.isTrial ? startOfDay(new Date()) : undefined,
      },
      include: { category: true },
    });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "CREATE",
      entityType: "Habit",
      entityId: habit.id,
      newValue: habit,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ habit }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
