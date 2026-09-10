import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { ApiError } from "@/lib/apiErrorBase";

// The calendar month view's day-click detail — habits and financial transactions for one day.
// Deliberately NOT events/tasks: /api/events?from=X&to=X (same day twice) already covers those
// for the existing month/week/day views, so the day-detail modal just fetches both in parallel
// instead of this route re-deriving what that one already does well.
export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date");
    if (!dateParam) throw new ApiError("پارامتر date لازم است.", 400);
    const date = new Date(dateParam);
    if (Number.isNaN(date.getTime())) throw new ApiError("تاریخ نامعتبر است.", 400);

    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(dayStart.getTime() + 86_400_000 - 1);

    const [habits, checkIns, transactions] = await Promise.all([
      prisma.habit.findMany({
        where: { userId, deletedAt: null, isActive: true, isTrial: false },
        select: { id: true, title: true, icon: true, color: true },
      }),
      prisma.habitCheckIn.findMany({
        where: { habit: { userId }, date: { gte: dayStart, lte: dayEnd } },
        select: { habitId: true, durationMin: true },
      }),
      prisma.transaction.findMany({
        where: { userId, deletedAt: null, date: { gte: dayStart, lte: dayEnd } },
        select: { id: true, type: true, amount: true, description: true, category: { select: { name: true, icon: true } } },
        orderBy: { date: "asc" },
      }),
    ]);

    const checkInByHabit = new Map(checkIns.map((c) => [c.habitId, c.durationMin]));
    const habitsResult = habits.map((h) => ({
      id: h.id,
      title: h.title,
      icon: h.icon,
      color: h.color,
      checkedIn: checkInByHabit.has(h.id),
      durationMin: checkInByHabit.get(h.id) ?? null,
    }));

    return NextResponse.json({ habits: habitsResult, transactions });
  } catch (err) {
    return handleApiError(err);
  }
}
