import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { daysSinceLastCheckIn, isHabitNeglected } from "@/lib/habitStreak";

const NEGLECT_THRESHOLD_DAYS = 3;
// Same as the neglect threshold: re-nudge every few days, not on every single poll.
const NUDGE_COOLDOWN_DAYS = 3;

/**
 * Lazily "fires" due reminders (and neglected-habit nudges) into Notification rows, then
 * returns unread notifications. This avoids needing a background worker for the MVP; the
 * client polls this endpoint.
 */
export async function GET() {
  try {
    const userId = await requireUserId();
    const now = new Date();

    const dueReminders = await prisma.reminder.findMany({
      where: { userId, notified: false, dismissed: false, remindAt: { lte: now } },
      include: { event: true, installment: { include: { plan: true } } },
    });

    for (const reminder of dueReminders) {
      let body = reminder.title;
      if (reminder.event) {
        body = `${reminder.event.title} - ${reminder.offsetMinutes >= 60 ? Math.round(reminder.offsetMinutes / 60) + " ساعت" : reminder.offsetMinutes + " دقیقه"} دیگر`;
      } else if (reminder.installment) {
        body = `قسط ${reminder.installment.amount.toLocaleString("en-US")} تومانی «${reminder.installment.plan.title}» به زودی سررسید می‌شود.`;
      }

      await prisma.notification.create({
        data: {
          userId,
          title: reminder.title,
          body,
          type: "reminder",
          relatedType: reminder.targetType,
          relatedId: reminder.eventId ?? reminder.installmentId ?? undefined,
        },
      });
      await prisma.reminder.update({ where: { id: reminder.id }, data: { notified: true } });
    }

    // Duolingo-style "come back to this" nudge: a habit gone quiet for a few days gets a
    // gentle re-engagement message suggesting the user revisit and downsize it, rather than
    // abandon it outright. lastNudgeSentAt guards against re-firing on every poll. Trial
    // habits (BJ Fogg's 3-day experiments) have their own dedicated keep/discard prompt on
    // /habits once the trial elapses, so they're excluded from this nudge.
    const activeHabits = await prisma.habit.findMany({ where: { userId, deletedAt: null, isActive: true, isTrial: false } });
    for (const habit of activeHabits) {
      const checkIns = await prisma.habitCheckIn.findMany({ where: { habitId: habit.id }, orderBy: { date: "desc" }, take: 1 });
      const daysSince = daysSinceLastCheckIn(checkIns, habit.createdAt, now);
      if (!isHabitNeglected(daysSince, NEGLECT_THRESHOLD_DAYS)) continue;

      const cooledDown =
        !habit.lastNudgeSentAt || now.getTime() - habit.lastNudgeSentAt.getTime() >= NUDGE_COOLDOWN_DAYS * 86_400_000;
      if (!cooledDown) continue;

      await prisma.notification.create({
        data: {
          userId,
          title: `عادت «${habit.title}» رو فراموش نکن`,
          body: `چند روزیه سراغ «${habit.title}» نرفتی. می‌خوای بازنگری‌اش کنی و یه پله کوچیک‌ترش کنی تا ادامه‌ دادنش راحت‌تر بشه؟`,
          type: "system",
          relatedType: "HABIT",
          relatedId: habit.id,
        },
      });
      await prisma.habit.update({ where: { id: habit.id }, data: { lastNudgeSentAt: now } });
    }

    const notifications = await prisma.notification.findMany({
      where: { userId, isRead: false },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({ notifications });
  } catch (err) {
    return handleApiError(err);
  }
}
