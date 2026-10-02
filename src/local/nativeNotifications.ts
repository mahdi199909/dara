// Best-effort native (Android) notification scheduling for Reminder rows — complements
// src/local/repositories/notifications.ts's lazy-poll mechanism (which only ever "fires" a due
// reminder into the in-app bell while the app happens to be open and polling /api/notifications).
// This is what makes the same reminder also pop up as a real system notification even when the
// app is fully closed, which is the whole point users are asking for.
//
// The plugin itself is only ever imported dynamically below (see every function here, and the
// rest of this codebase's own Capacitor plugin usage) so this native-only code never enters the
// plain web bundle.
//
// Everything that talks to the plugin goes through one queue, in the order it was asked for. That
// matters for reconcile (getPending → cancel what is no longer wanted → schedule what is): run
// alongside a reminder that was created a moment after its list was read, it would cancel that
// brand-new alarm as "stale".
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
 * The channel every reminder rings on. Android 8+ decides how loudly a notification behaves per
 * channel — and only ever from the moment the channel is created, the app cannot raise it later —
 * while the plugin's own fallback channel is "default" importance: no heads-up banner, just a small
 * icon in the status bar that is easy to miss (and easy to think never came).
 */
export const REMINDER_CHANNEL_ID = "parva_reminders";

/** Android importance 4 = HIGH: sound, and a banner over whatever is on screen. */
const HIGH_IMPORTANCE = 4;

/** Lock-screen visibility 0 = PRIVATE: the notification shows, its text (an event's title, an installment's amount) does not. The plugin's channel default would be PUBLIC. */
const PRIVATE_VISIBILITY = 0;

/**
 * The id of the «اعلان آزمایشی» notification. A fixed number instead of a hash of a UUID (every
 * reminder's id) — the reconcile below leaves it alone, so a test scheduled a minute ahead survives
 * the person switching out of the app and back in (which reconciles).
 */
export const TEST_NOTIFICATION_ID = 2_147_483_001;

/** The «زمان‌سنج» ringing when a countdown or a pomodoro block ends. */
export const TIMER_NOTIFICATION_ID = 2_147_483_002;

/** The «صندوق ورودی» review reminders: the next few occasions are armed at once, one id each. */
export const INBOX_REVIEW_NOTIFICATION_IDS = [2_147_483_010, 2_147_483_011, 2_147_483_012, 2_147_483_013, 2_147_483_014, 2_147_483_015, 2_147_483_016] as const;

/** Notifications with a fixed id belong to a feature of their own, not to a Reminder row — the reconcile below leaves them alone. */
const FIXED_NOTIFICATION_IDS: ReadonlySet<number> = new Set([TEST_NOTIFICATION_ID, TIMER_NOTIFICATION_ID, ...INBOX_REVIEW_NOTIFICATION_IDS]);

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

type Plugin = (typeof import("@capacitor/local-notifications"))["LocalNotifications"];

/**
 * The plugin, boxed. A Capacitor plugin is a proxy that answers to every property name — `then`
 * included — so a promise (an async function's return value) resolved with the bare plugin treats
 * it as a thenable and calls plugin.then(): "LocalNotifications.then() is not implemented".
 */
async function loadPlugin(): Promise<{ plugin: Plugin }> {
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  return { plugin: LocalNotifications };
}

let queue: Promise<unknown> = Promise.resolve();

/** Runs `task` after everything already asked of the plugin has finished; a failing task does not stop the ones behind it. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

let channelReady: Promise<string | undefined> | null = null;

/**
 * Creates the reminders channel (once per app run; creating one that already exists is a no-op
 * for Android) and resolves with its id — or with undefined when that failed, in which case a
 * reminder is scheduled on the plugin's default channel rather than not at all.
 */
function ensureReminderChannel(plugin: Plugin): Promise<string | undefined> {
  if (!channelReady) {
    channelReady = (async () => {
      try {
        await plugin.createChannel({
          id: REMINDER_CHANNEL_ID,
          name: "یادآورها",
          description: "اعلان رویدادها و سررسید قسط‌ها",
          importance: HIGH_IMPORTANCE,
          visibility: PRIVATE_VISIBILITY,
          vibration: true,
          lights: true,
        });
        return REMINDER_CHANNEL_ID;
      } catch (err) {
        // Below Android 8 there are no channels at all: that is an answer, not a failure — remember it and stay quiet.
        if ((err as { code?: string } | null)?.code === "UNAVAILABLE") return undefined;
        channelReady = null; // try again with the next reminder
        log.warn("LOCAL_NOTIFICATION_CHANNEL_FAILED", { error: err, layer: "local" });
        return undefined;
      }
    })();
  }
  return channelReady;
}

/**
 * Whether the system lets the app arm exact alarms right now. Asked every time instead of cached:
 * it is one quick native call, the answer changes when the person flips the switch in system
 * settings, and a stale "yes" would make the plugin bounce them to that settings screen in the
 * middle of saving an event.
 */
async function exactAlarmsAllowed(plugin: Plugin): Promise<boolean> {
  try {
    return (await plugin.checkExactNotificationSetting()).exact_alarm === "granted";
  } catch {
    return false;
  }
}

/**
 * How a reminder is armed on this phone: on the reminders channel, and — only when the system
 * already allows it — as an exact alarm.
 *
 * An inexact alarm (what every reminder used to be) is handed to the system to deliver whenever it
 * finds convenient: it is batched with other apps' alarms, held back by battery-saver modes, and
 * on a phone that has not opened the app for a while can arrive many minutes late — "remind me
 * 30 minutes before" then means "sometime around the meeting". An exact alarm rings at the minute
 * asked. It is never requested when the permission is missing: the plugin answers such a request by
 * opening the system's "Alarms & reminders" screen in the middle of whatever the person was doing
 * (which is why every reminder used to be inexact). The manifest asks for USE_EXACT_ALARM, which
 * Android 13+ grants for a calendar app without any screen; Android 12 grants SCHEDULE_EXACT_ALARM
 * by default; on 14 the person can allow it from Settings → «اعلان‌ها و یادآورها».
 */
async function armingOptions(plugin: Plugin): Promise<{ channelId: string | undefined; exact: boolean }> {
  const [channelId, exact] = await Promise.all([ensureReminderChannel(plugin), exactAlarmsAllowed(plugin)]);
  return { channelId, exact };
}

/**
 * The status-bar icon and its tint. Without a name the plugin falls back to Android's generic "i" in a
 * circle (ic_dialog_info), which reads as an upside-down exclamation mark, not as this app. The drawable is
 * android/app/src/main/res/drawable/ic_stat_parva.xml (a white silhouette, as Android requires).
 */
export const NOTIFICATION_SMALL_ICON = "ic_stat_parva";
export const NOTIFICATION_ICON_COLOR = "#0E5F54";

function notificationFor(reminder: ScheduledReminder, options: { channelId: string | undefined; exact: boolean }) {
  return {
    id: reminderNotificationId(reminder.id),
    smallIcon: NOTIFICATION_SMALL_ICON,
    iconColor: NOTIFICATION_ICON_COLOR,
    title: reminder.title,
    body: reminder.body,
    schedule: { at: new Date(reminder.remindAt), allowWhileIdle: true },
    channelId: options.channelId,
    isExactNotification: options.exact,
  };
}

export type NotificationPermissionResult = "granted" | "denied" | "unavailable";

/** Best-effort — call once on native boot (see FirstRunGate.tsx) so the OS permission prompt, if
 * any, happens up front instead of surprising the user the first time they add a reminder. Says
 * what came of it, because a refusal used to vanish without a trace: every reminder afterwards
 * was silently thrown away by the OS, and nothing on screen said why no notification ever came. */
export async function requestNotificationPermission(): Promise<NotificationPermissionResult> {
  try {
    const { plugin } = await loadPlugin();
    const result = await plugin.requestPermissions();
    if (result?.display === "granted") return "granted";
    log.warn("LOCAL_NOTIFICATION_PERMISSION_FAILED", { errorCode: "NOTIF-002", layer: "local", permission: result?.display ?? "unknown" });
    return "denied";
  } catch (err) {
    log.warn("LOCAL_NOTIFICATION_PERMISSION_FAILED", { error: err, errorCode: "NOTIF-002", layer: "local" });
    return "unavailable";
  }
}

/**
 * Schedules one Reminder as a real OS notification. Fire-and-forget by design: never block the
 * caller's synchronous DB insert on a native plugin round trip, and never let a scheduling
 * failure (permission denied, or simply running in a plain browser with no such plugin) surface
 * as an error from what's otherwise a plain local database write.
 *
 * A reminder whose moment has already passed is not scheduled (the OS would fire it on the spot,
 * long after it was meant to ring) — the event form warns before that can happen.
 */
export function scheduleReminderNotification(reminder: ScheduledReminder): void {
  void enqueue(async () => {
    try {
      const at = new Date(reminder.remindAt);
      if (at.getTime() <= Date.now()) {
        log.debug("LOCAL_NOTIFICATION_SKIPPED", { layer: "local", entityType: "reminder", entityId: reminder.id, reason: "its time had already passed" });
        return;
      }
      const { plugin } = await loadPlugin();
      const options = await armingOptions(plugin);
      await plugin.schedule({ notifications: [notificationFor(reminder, options)] });
      // The reminder's id and the moment it will ring — never its title or body.
      log.debug("LOCAL_NOTIFICATION_SCHEDULED", { layer: "local", entityType: "reminder", entityId: reminder.id, scheduledFor: at.toISOString(), exact: options.exact });
    } catch (err) {
      log.error("LOCAL_NOTIFICATION_FAILED", { error: err, errorCode: "NOTIF-001", layer: "local", operation: "schedule", entityType: "reminder", entityId: reminder.id });
    }
  });
}

/**
 * Moves an already-scheduled reminder to a new time (e.g. an event's startAt changed) — or arms it
 * for the first time when it was never armed. Scheduling an id that is already pending replaces it,
 * so this is a plain schedule; the plugin's own update() would be wrong here, because it silently
 * ignores an id it does not know, and a reminder that was skipped as "already passed" (or created
 * before notifications were allowed) and then moved into the future would never ring.
 */
export function rescheduleReminderNotification(reminder: ScheduledReminder): void {
  void enqueue(async () => {
    try {
      const at = new Date(reminder.remindAt);
      const { plugin } = await loadPlugin();
      if (at.getTime() <= Date.now()) {
        await plugin.cancel({ notifications: [{ id: reminderNotificationId(reminder.id) }] });
        log.debug("LOCAL_NOTIFICATION_CANCELLED", { layer: "local", entityType: "reminder", entityId: reminder.id, reason: "moved to a time that has passed" });
        return;
      }
      const options = await armingOptions(plugin);
      await plugin.schedule({ notifications: [notificationFor(reminder, options)] });
      log.debug("LOCAL_NOTIFICATION_RESCHEDULED", { layer: "local", entityType: "reminder", entityId: reminder.id, scheduledFor: at.toISOString(), exact: options.exact });
    } catch (err) {
      log.error("LOCAL_NOTIFICATION_FAILED", { error: err, errorCode: "NOTIF-001", layer: "local", operation: "reschedule", entityType: "reminder", entityId: reminder.id });
    }
  });
}

/** Cancels a reminder's scheduled native notification — must be called whenever the underlying
 * Reminder row (or its parent Event/InstallmentPlan) is deleted, since Android's own alarm
 * scheduler has no idea the app's database changed and would otherwise still fire it. */
export function cancelReminderNotification(reminderId: string): void {
  void enqueue(async () => {
    try {
      const { plugin } = await loadPlugin();
      await plugin.cancel({ notifications: [{ id: reminderNotificationId(reminderId) }] });
      log.debug("LOCAL_NOTIFICATION_CANCELLED", { layer: "local", entityType: "reminder", entityId: reminderId, reason: "removed" });
    } catch (err) {
      log.error("LOCAL_NOTIFICATION_FAILED", { error: err, errorCode: "NOTIF-001", layer: "local", operation: "cancel", entityType: "reminder", entityId: reminderId });
    }
  });
}

export function cancelReminderNotifications(reminderIds: string[]): void {
  for (const id of reminderIds) cancelReminderNotification(id);
}

/**
 * Makes the OS's pending notifications exactly `wanted`: schedules (or re-times — scheduling an id
 * that is already pending replaces it) every wanted reminder and cancels any pending one that is
 * no longer wanted. Reminders are the only notifications this app schedules (apart from the
 * one-off test notification, which is left alone), which is what makes "not in the list" mean
 * "stale". Used after a sync, for reminders that were created, moved or removed on another device,
 * and on every launch and return to the app, which is what re-arms alarms Android forgot (an APK
 * update or a force-stop wipes every alarm of the app).
 *
 * Does nothing while notifications are not allowed: every schedule call would be refused, and on
 * Android 13+ a schedule call is also what pops the permission dialog — not something to do behind
 * the person's back each time they return to the app (Settings → «اعلان‌ها و یادآورها» and the
 * banner ask for the permission on purpose, and reconcile again once it is given).
 */
export function syncScheduledReminderNotifications(wanted: ScheduledReminder[]): void {
  void enqueue(async () => {
    try {
      const { plugin } = await loadPlugin();
      const permission = await plugin.checkPermissions();
      if (permission?.display !== "granted") {
        log.debug("LOCAL_NOTIFICATION_SKIPPED", { layer: "local", reason: "notifications are not allowed", permission: permission?.display ?? "unknown", wanted: wanted.length });
        return;
      }
      const wantedIds = new Set(wanted.map((w) => reminderNotificationId(w.id)));
      const pending = await plugin.getPending();
      const stale = pending.notifications.filter((n) => !wantedIds.has(n.id) && !FIXED_NOTIFICATION_IDS.has(n.id));
      if (stale.length > 0) await plugin.cancel({ notifications: stale.map((n) => ({ id: n.id })) });
      if (wanted.length > 0) {
        const options = await armingOptions(plugin);
        await plugin.schedule({ notifications: wanted.map((w) => notificationFor(w, options)) });
        log.debug("LOCAL_NOTIFICATION_RECONCILED", { layer: "local", wanted: wanted.length, cancelledStale: stale.length, exact: options.exact });
      } else {
        log.debug("LOCAL_NOTIFICATION_RECONCILED", { layer: "local", wanted: 0, cancelledStale: stale.length });
      }
    } catch (err) {
      log.error("LOCAL_NOTIFICATION_FAILED", { error: err, errorCode: "NOTIF-001", layer: "local", operation: "reconcile", wanted: wanted.length });
    }
  });
}

/**
 * The «اعلان آزمایشی» button in Settings: rings one notification `delaySeconds` from now, through
 * exactly the same channel and alarm type a real reminder gets. A delay of a minute or so lets the
 * person close the app first, which is the situation that actually matters. Unlike everything
 * above this reports failure to its caller, because the caller is a person waiting to see whether
 * it works.
 */
export function sendTestNotification(options: { title: string; body: string; delaySeconds: number }): Promise<{ at: Date; exact: boolean }> {
  return enqueue(async () => {
    try {
      const { plugin } = await loadPlugin();
      const arming = await armingOptions(plugin);
      const at = new Date(Date.now() + Math.max(1, options.delaySeconds) * 1000);
      await plugin.schedule({
        notifications: [
          {
            id: TEST_NOTIFICATION_ID,
            smallIcon: NOTIFICATION_SMALL_ICON,
            iconColor: NOTIFICATION_ICON_COLOR,
            title: options.title,
            body: options.body,
            schedule: { at, allowWhileIdle: true },
            channelId: arming.channelId,
            isExactNotification: arming.exact,
          },
        ],
      });
      log.info("LOCAL_NOTIFICATION_TEST_SENT", { layer: "local", scheduledFor: at.toISOString(), exact: arming.exact, delaySeconds: options.delaySeconds });
      return { at, exact: arming.exact };
    } catch (err) {
      log.error("LOCAL_NOTIFICATION_FAILED", { error: err, errorCode: "NOTIF-001", layer: "local", operation: "test" });
      throw err;
    }
  });
}

export interface FixedNotification {
  id: number;
  title: string;
  body: string;
  at: Date;
}

/**
 * Makes the given fixed ids ring exactly `wanted`: every id in `ids` is cancelled first, then each
 * wanted one (all of whose ids must be in `ids`) is armed — the timer and the inbox review each own
 * their ids and replace their own set in one call. Quietly does nothing while notifications are not
 * allowed (same reason as the reconcile above: never pop the permission dialog behind someone's back).
 */
export function replaceFixedNotifications(ids: readonly number[], wanted: FixedNotification[]): void {
  void enqueue(async () => {
    try {
      const { plugin } = await loadPlugin();
      const permission = await plugin.checkPermissions();
      if (permission?.display !== "granted") return;
      if (ids.length > 0) await plugin.cancel({ notifications: ids.map((id) => ({ id })) });
      const future = wanted.filter((w) => w.at.getTime() > Date.now());
      if (future.length === 0) return;
      const arming = await armingOptions(plugin);
      await plugin.schedule({
        notifications: future.map((w) => ({
          id: w.id,
          smallIcon: NOTIFICATION_SMALL_ICON,
          iconColor: NOTIFICATION_ICON_COLOR,
          title: w.title,
          body: w.body,
          schedule: { at: w.at, allowWhileIdle: true },
          channelId: arming.channelId,
          isExactNotification: arming.exact,
        })),
      });
      log.debug("LOCAL_NOTIFICATION_SCHEDULED", { layer: "local", entityType: "fixed", count: future.length, exact: arming.exact });
    } catch (err) {
      log.error("LOCAL_NOTIFICATION_FAILED", { error: err, errorCode: "NOTIF-001", layer: "local", operation: "fixed" });
    }
  });
}

/** Forgets what this module remembers between calls (the channel it already created) — tests only. */
export function resetNativeNotificationsForTests(): void {
  channelReady = null;
}
