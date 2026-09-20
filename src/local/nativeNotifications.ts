// Best-effort native (Android) notification scheduling for Reminder rows — complements
// src/local/repositories/notifications.ts's lazy-poll mechanism (which only ever "fires" a due
// reminder into the in-app bell while the app happens to be open and polling /api/notifications).
// This is what makes the same reminder also pop up as a real system notification even when the
// app is fully closed, which is the whole point users are asking for.
//
// The plugin itself is only ever imported dynamically below (see every function here, and the
// rest of this codebase's own Capacitor plugin usage) so this native-only code never enters the
// plain web bundle.
import { getLogger } from "../lib/observability";

const log = getLogger("notifications", "native");

/** What the OS needs to know to ring one reminder. */
export interface ScheduledReminder {
  id: string;
  title: string;
  body: string;
  remindAt: string;
}

/**
 * Same algorithm as Java's String.hashCode() — deterministic, and the `| 0` keeps the result
 * within the signed 32-bit range the plugin's own `id` field requires. A Reminder's real id is a
 * UUID string, so this is how a stable, collision-unlikely native notification id is derived from
 * it (needed to schedule/update/cancel the exact same OS-level notification later).
 */
function reminderNotificationId(reminderId: string): number {
  let h = 0;
  for (let i = 0; i < reminderId.length; i++) h = (h * 31 + reminderId.charCodeAt(i)) | 0;
  return h;
}

/** Best-effort — call once on native boot (see FirstRunGate.tsx) so the OS permission prompt, if
 * any, happens up front instead of surprising the user the first time they add a reminder. */
export async function requestNotificationPermission(): Promise<void> {
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.requestPermissions();
  } catch (err) {
    log.warn("LOCAL_NOTIFICATION_PERMISSION_FAILED", { error: err, errorCode: "NOTIF-002", layer: "local" });
  }
}

/**
 * Schedules one Reminder as a real OS notification. Fire-and-forget by design: never block the
 * caller's synchronous DB insert on a native plugin round trip, and never let a scheduling
 * failure (permission denied, or simply running in a plain browser with no such plugin) surface
 * as an error from what's otherwise a plain local database write.
 *
 * isExactNotification is explicitly false — Android 12+'s exact-alarm path would otherwise
 * redirect the user straight to a system "Alarms & reminders" settings screen the first time any
 * reminder gets scheduled, just from creating a task. Exact-to-the-minute timing isn't worth that
 * surprise (or the SCHEDULE_EXACT_ALARM manifest permission and the Play Store scrutiny that
 * comes with declaring it) for a "remind me about this" nudge — a few minutes of slack from the
 * OS's own inexact-alarm scheduling is a fine trade.
 */
export function scheduleReminderNotification(reminder: { id: string; title: string; body: string; remindAt: string }): void {
  void (async () => {
    try {
      const at = new Date(reminder.remindAt);
      if (at.getTime() <= Date.now()) return; // already due — the in-app lazy-fire path (notifications.ts) covers this instead
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      await LocalNotifications.schedule({
        notifications: [
          {
            id: reminderNotificationId(reminder.id),
            title: reminder.title,
            body: reminder.body,
            schedule: { at, allowWhileIdle: true },
            isExactNotification: false,
          },
        ],
      });
    } catch (err) {
      log.error("LOCAL_NOTIFICATION_FAILED", { error: err, errorCode: "NOTIF-001", layer: "local", operation: "schedule", entityType: "reminder", entityId: reminder.id });
    }
  })();
}

/** Reschedules an already-scheduled reminder to a new time (e.g. an event's startAt changed) —
 * same notification id, matched by LocalNotifications.update() rather than a cancel+reschedule
 * pair. */
export function rescheduleReminderNotification(reminder: { id: string; title: string; body: string; remindAt: string }): void {
  void (async () => {
    try {
      const at = new Date(reminder.remindAt);
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      if (at.getTime() <= Date.now()) {
        await LocalNotifications.cancel({ notifications: [{ id: reminderNotificationId(reminder.id) }] });
        return;
      }
      await LocalNotifications.update({
        notifications: [
          { id: reminderNotificationId(reminder.id), title: reminder.title, body: reminder.body, schedule: { at, allowWhileIdle: true } },
        ],
      });
    } catch (err) {
      log.error("LOCAL_NOTIFICATION_FAILED", { error: err, errorCode: "NOTIF-001", layer: "local", operation: "reschedule", entityType: "reminder", entityId: reminder.id });
    }
  })();
}

/** Cancels a reminder's scheduled native notification — must be called whenever the underlying
 * Reminder row (or its parent Event/InstallmentPlan) is deleted, since Android's own alarm
 * scheduler has no idea the app's database changed and would otherwise still fire it. */
export function cancelReminderNotification(reminderId: string): void {
  void (async () => {
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      await LocalNotifications.cancel({ notifications: [{ id: reminderNotificationId(reminderId) }] });
    } catch (err) {
      log.error("LOCAL_NOTIFICATION_FAILED", { error: err, errorCode: "NOTIF-001", layer: "local", operation: "cancel", entityType: "reminder", entityId: reminderId });
    }
  })();
}

export function cancelReminderNotifications(reminderIds: string[]): void {
  for (const id of reminderIds) cancelReminderNotification(id);
}

/**
 * Makes the OS's pending notifications exactly `wanted`: schedules (or re-times — scheduling an id
 * that is already pending replaces it) every wanted reminder and cancels any pending one that is
 * no longer wanted. Reminders are the only notifications this app schedules, which is what makes
 * "not in the list" mean "stale". Used after a sync, for reminders that were created, moved or
 * removed on another device — the ones the phone's own repositories never saw happen.
 */
export function syncScheduledReminderNotifications(wanted: ScheduledReminder[]): void {
  void (async () => {
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const wantedIds = new Set(wanted.map((w) => reminderNotificationId(w.id)));
      const pending = await LocalNotifications.getPending();
      const stale = pending.notifications.filter((n) => !wantedIds.has(n.id));
      if (stale.length > 0) await LocalNotifications.cancel({ notifications: stale.map((n) => ({ id: n.id })) });
      if (wanted.length > 0) {
        await LocalNotifications.schedule({
          notifications: wanted.map((w) => ({
            id: reminderNotificationId(w.id),
            title: w.title,
            body: w.body,
            schedule: { at: new Date(w.remindAt), allowWhileIdle: true },
            isExactNotification: false,
          })),
        });
      }
    } catch (err) {
      log.error("LOCAL_NOTIFICATION_FAILED", { error: err, errorCode: "NOTIF-001", layer: "local", operation: "reconcile", wanted: wanted.length });
    }
  })();
}
