// Keeps the phone's scheduled system notifications in step with the Reminder table.
//
// A reminder created, moved or deleted through the phone's own repositories schedules/updates/
// cancels its OS-level notification on the spot (see nativeNotifications.ts and the repositories).
// One that arrives from the web — a new event's reminders, an event that was rescheduled, a
// reminder that was removed there — is only ever written to SQLite by the sync's pull, so without
// this step it would never ring on the phone while the app is closed.
//
// The same step also repairs everything that can go wrong on the phone's side: Android forgets
// every alarm of an app when the APK is updated or the app is force-stopped, a reminder written
// before the notification permission was granted was never handed to the system, and one created
// inside a transaction that later rolled back is still armed. So it runs not only after a sync but
// on every launch and every return to the app (FirstRunGate, WidgetQueueDrainer).
import { expandOccurrences } from "@/lib/recurrence";
import { eventReminderBody } from "@/lib/reminderText";
import { installmentNotifyAt } from "@/lib/reminderTiming";
import { getLocalDbInstance, type LocalDb } from "./db";
import { syncScheduledReminderNotifications, type ScheduledReminder } from "./nativeNotifications";

/** Android caps an app at 500 pending alarms and throws past that; the soonest hundred are plenty. */
const MAX_SCHEDULED = 100;

/** How far ahead the repeats of a recurring event are handed to the OS. */
const RECURRENCE_HORIZON_DAYS = 60;

/** …and how many repeats of one reminder at most, so a daily event cannot use up the whole quota by itself. */
const MAX_REPEATS_PER_REMINDER = 14;

/** An installment reminder rings up to 9 hours after its stored moment (see installmentNotifyAt), so the query reaches a day back and the exact test is done in code. */
const LOOKBACK_MS = 24 * 3_600_000;

interface RecurringReminderRow {
  id: string;
  title: string;
  offsetMinutes: number;
  eventId: string;
  eventTitle: string;
  startAt: string;
  endAt: string;
  recurrenceFreq: string;
  recurrenceInterval: number;
  recurrenceUntil: string | null;
  recurrenceCount: number | null;
}

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
 * The reminders that should currently be pending in the OS: not fired, not dismissed, still ahead,
 * and belonging to an event / a not-yet-paid installment of an installment plan that hasn't been
 * deleted. Soonest first, worded exactly like the in-app bell and the notifications the
 * repositories schedule, and timed as the repositories time them (an installment reminder rings
 * at 09:00 rather than at midnight).
 */
export function upcomingReminderNotifications(db: LocalDb, now: Date = new Date(), limit = MAX_SCHEDULED): ScheduledReminder[] {
  const rows = db.all<UpcomingRow>(
    `SELECT r."id" AS id, r."title" AS title, r."offsetMinutes" AS offsetMinutes, r."remindAt" AS remindAt,
            e."title" AS eventTitle, p."title" AS planTitle, i."amount" AS installmentAmount
       FROM "Reminder" r
       LEFT JOIN "Event" e ON e."id" = r."eventId" AND e."deletedAt" IS NULL
       LEFT JOIN "Installment" i ON i."id" = r."installmentId" AND i."status" <> 'PAID'
       LEFT JOIN "InstallmentPlan" p ON p."id" = i."planId" AND p."deletedAt" IS NULL
      WHERE r."notified" = 0 AND r."dismissed" = 0 AND r."remindAt" > ?
        AND (e."id" IS NOT NULL OR p."id" IS NOT NULL)`,
    [new Date(now.getTime() - LOOKBACK_MS).toISOString()]
  );

  const stored: ScheduledReminder[] = rows.map((r) => {
    const isEvent = r.eventTitle !== null;
    const rings = isEvent ? new Date(r.remindAt) : installmentNotifyAt(new Date(r.remindAt));
    return {
      id: r.id,
      title: r.title,
      remindAt: rings.toISOString(),
      body: isEvent
        ? eventReminderBody(r.eventTitle as string, r.offsetMinutes)
        : `قسط ${(r.installmentAmount ?? 0).toLocaleString("en-US")} تومانی «${r.planTitle}» به زودی سررسید می‌شود.`,
    };
  });

  return [...stored, ...upcomingRepeatReminders(db, now)]
    .filter((r) => new Date(r.remindAt).getTime() > now.getTime())
    .sort((a, b) => a.remindAt.localeCompare(b.remindAt))
    .slice(0, limit);
}

/**
 * The later occurrences of recurring events. A Reminder row is a single moment — its event's first
 * start minus its lead time — so a weekly class or a daily routine rang once, for the first
 * occurrence, and never again. The repeats are worked out here, from the event's own recurrence
 * rule, for the next couple of months. Each gets its own system notification (id "<reminder>::<n>",
 * n = the repeat's number in the series); repeat 0 is the event's own start, which the Reminder
 * row itself covers. Which of them ring is decided again on every launch and return to the app, so
 * a series keeps being armed ahead of the person for as long as they use the phone.
 */
function upcomingRepeatReminders(db: LocalDb, now: Date): ScheduledReminder[] {
  const rows = db.all<RecurringReminderRow>(
    `SELECT r."id" AS id, r."title" AS title, r."offsetMinutes" AS offsetMinutes,
            e."id" AS eventId, e."title" AS eventTitle, e."startAt" AS startAt, e."endAt" AS endAt,
            e."recurrenceFreq" AS recurrenceFreq, e."recurrenceInterval" AS recurrenceInterval,
            e."recurrenceUntil" AS recurrenceUntil, e."recurrenceCount" AS recurrenceCount
       FROM "Reminder" r
       JOIN "Event" e ON e."id" = r."eventId" AND e."deletedAt" IS NULL
      WHERE r."dismissed" = 0 AND e."recurrenceFreq" <> 'NONE' AND e."recurrenceParentId" IS NULL`
  );
  const horizon = new Date(now.getTime() + RECURRENCE_HORIZON_DAYS * 24 * 3_600_000);

  const repeats: ScheduledReminder[] = [];
  for (const r of rows) {
    const occurrences = expandOccurrences(
      {
        id: r.eventId,
        startAt: new Date(r.startAt),
        endAt: new Date(r.endAt),
        recurrenceFreq: r.recurrenceFreq,
        recurrenceInterval: r.recurrenceInterval || 1,
        recurrenceUntil: r.recurrenceUntil ? new Date(r.recurrenceUntil) : null,
        recurrenceCount: r.recurrenceCount,
      },
      now,
      horizon
    );
    let armed = 0;
    for (const occurrence of occurrences) {
      const index = Number(occurrence.occurrenceId.split("::")[1]);
      if (!index) continue; // the event's own start: the Reminder row covers it
      const rings = occurrence.startAt.getTime() - r.offsetMinutes * 60_000;
      if (rings <= now.getTime()) continue;
      repeats.push({ id: `${r.id}::${index}`, title: r.title, remindAt: new Date(rings).toISOString(), body: eventReminderBody(r.eventTitle, r.offsetMinutes) });
      if (++armed >= MAX_REPEATS_PER_REMINDER) break;
    }
  }
  return repeats;
}

/** Makes the OS's pending notifications exactly the reminders in the database. Fire-and-forget. */
export function reconcileReminderNotifications(db: LocalDb, now: Date = new Date()): void {
  syncScheduledReminderNotifications(upcomingReminderNotifications(db, now));
}

/** The same, for a caller with no database handle at hand — a resume listener, or the notification settings once the person has allowed notifications. A no-op before the database is open. */
export function rearmReminderNotifications(): void {
  const db = getLocalDbInstance();
  if (db) reconcileReminderNotifications(db);
}
