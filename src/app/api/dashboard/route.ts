import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { computeTimeAndMoneyReport, computeNetWorth } from "@/lib/reportEngine";
import { toJalali, jalaliMonthRange } from "@/lib/jalali";
import { summarizeInstallments } from "@/lib/installments";
import { expandOccurrences } from "@/lib/recurrence";

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export async function GET() {
  try {
    const userId = await requireUserId();
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);

    const { jy, jm } = toJalali(now);
    const { start: monthStart, end: monthEnd } = jalaliMonthRange(jy, jm);

    const [todayReport, monthReport, netWorth, tasksToday, plans, recentActivities, allEvents, categories] =
      await Promise.all([
        computeTimeAndMoneyReport(userId, todayStart, todayEnd),
        computeTimeAndMoneyReport(userId, monthStart, monthEnd),
        computeNetWorth(userId),
        prisma.task.findMany({
          where: {
            userId,
            deletedAt: null,
            OR: [{ dueDate: { gte: todayStart, lte: todayEnd } }, { status: { not: "DONE" }, dueDate: null }],
          },
          include: { category: true, project: true },
          orderBy: { createdAt: "desc" },
          take: 8,
        }),
        prisma.installmentPlan.findMany({
          where: { userId, deletedAt: null },
          include: { installments: { where: { dueDate: { gte: monthStart, lte: monthEnd } } } },
        }),
        prisma.activity.findMany({
          where: { userId, deletedAt: null },
          include: { category: true, timeEntries: true },
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
        prisma.event.findMany({ where: { userId, deletedAt: null, recurrenceParentId: null }, include: { category: true } }),
        prisma.category.findMany({ where: { userId, deletedAt: null } }),
      ]);

    const eventsToday = allEvents
      .flatMap((e) => expandOccurrences(e, todayStart, todayEnd).map((occ) => ({ ...occ, event: e })))
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

    const upcomingWindowEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const upcomingEvents = allEvents
      .flatMap((e) => expandOccurrences(e, now, upcomingWindowEnd).map((occ) => ({ ...occ, event: e })))
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
      .slice(0, 5);

    const monthInstallments = plans.flatMap((p) => p.installments.map((i) => ({ ...i, planTitle: p.title })));
    const installmentSummary = summarizeInstallments(monthInstallments);

    const activeRunningTimer = await prisma.timeEntry.findFirst({
      where: { activity: { userId, deletedAt: null }, isRunning: true },
      include: { activity: true },
    });

    return NextResponse.json({
      today: todayReport,
      month: monthReport,
      netWorth,
      tasksToday,
      eventsToday,
      upcomingEvents,
      monthInstallments: installmentSummary,
      recentActivities,
      activeRunningTimer,
      categories,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
