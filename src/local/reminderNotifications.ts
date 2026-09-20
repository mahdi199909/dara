// Keeps the phone's scheduled system notifications in step with the Reminder table after a sync.
//
// A reminder created, moved or deleted through the phone's own repositories schedules/updates/
// cancels its OS-level notification on the spot (see nativeNotifications.ts and the repositories).
// One that arrives from the web — a new event's reminders, an event that was rescheduled, a
// reminder that was removed there — is only ever written to SQLite by the sync's pull, so without
// this step it would never ring on the phone while the app is closed.
import { formatReminderOffset } from "@/lib/reminderText";
import type { LocalDb } from "./db";
import { syncScheduledReminderNotifications, type ScheduledReminder } from "./nativeNotifications";

/** Android keeps every scheduled notification in an alarm slot; the soonest few dozen are plenty. */
const MAX_SCHEDULED = 64;

interface UpcomingRow {
  id: string;
  title: string;
  offsetMinutes: number;
  remindAt: string;
  eventTitle: string | null;
  planTitle: string | null;
  installmentAmount: number | null;
}

/**
 * The reminders that should currently be pending in the OS: not fired, not dismissed, still in the
 * future, and belonging to an event / installment plan that hasn't been deleted. Soonest first,
 * worded exactly like the in-app bell and the notifications the repositories schedule.
 */
export function upcomingReminderNotifications(db: LocalDb, now: Date = new Date(), limit = MAX_SCHEDULED): ScheduledReminder[] {
  const rows = db.all<UpcomingRow>(
    `SELECT r."id" AS id, r."title" AS title, r."offsetMinutes" AS offsetMinutes, r."remindAt" AS remindAt,
            e."title" AS eventTitle, p."title" AS planTitle, i."amount" AS installmentAmount
       FROM "Reminder" r
       LEFT JOIN "Event" e ON e."id" = r."eventId" AND e."deletedAt" IS NULL
       LEFT JOIN "Installment" i ON i."id" = r."installmentId"
       LEFT JOIN "InstallmentPlan" p ON p."id" = i."planId" AND p."deletedAt" IS NULL
      WHERE r."notified" = 0 AND r."dismissed" = 0 AND r."remindAt" > ?
        AND (e."id" IS NOT NULL OR p."id" IS NOT NULL)
      ORDER BY r."remindAt" ASC
      LIMIT ?`,
    [now.toISOString(), limit]
  );

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    remindAt: r.remindAt,
    body:
      r.eventTitle !== null
        ? `${r.eventTitle} - ${formatReminderOffset(r.offsetMinutes)} دیگر`
        : `قسط ${(r.installmentAmount ?? 0).toLocaleString("en-US")} تومانی «${r.planTitle}» به زودی سررسید می‌شود.`,
  }));
}

/** Makes the OS's pending notifications exactly the reminders in the database. Fire-and-forget. */
export function reconcileReminderNotifications(db: LocalDb, now: Date = new Date()): void {
  syncScheduledReminderNotifications(upcomingReminderNotifications(db, now));
}
