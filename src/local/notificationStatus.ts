// What the phone lets the app do with notifications — read for the Settings card, the "notifications
// are off" banner, and the log — plus the few actions that fix each thing that is off.
//
// Before this existed a notification that did not arrive gave no clue why: the permission prompt's
// answer was thrown away, a reminder the OS refused was only a line in a log nobody reads, and the
// battery restrictions that kill an alarm on many Android phones (Xiaomi's autostart, Samsung's
// sleeping apps, the system's own battery optimization) were invisible. Each of those is a row in
// Settings → «اعلان‌ها و یادآورها» now, with the button that opens the right system screen.
import { getLogger } from "../lib/observability";
import { REMINDER_CHANNEL_ID, requestNotificationPermission } from "./nativeNotifications";
import { rearmReminderNotifications } from "./reminderNotifications";

const log = getLogger("notifications", "status");

export interface NotificationStatus {
  /** false in a plain browser, or when the native plugin does not answer. */
  available: boolean;
  /** "granted"; "denied" (refused — Android will not ask again, only system settings can change it); "prompt" (never decided — asking shows the system dialog). */
  permission: "granted" | "denied" | "prompt";
  /** The system lets the app arm exact alarms, so reminders ring at the minute asked. */
  exactAlarms: boolean;
  /** The person muted the reminders channel in system settings — the app is allowed, yet nothing shows. */
  channelMuted: boolean;
  /** Notifications the app has handed to the system and not yet rung (reminders, and a pending test). */
  scheduled: number;
  /** false = battery optimization may stop the app's alarms; null = this build/phone cannot say. */
  batteryUnrestricted: boolean | null;
  /** Lower-case brand of the phone ("xiaomi", "samsung"…) — the battery advice differs per brand; null when unknown. */
  manufacturer: string | null;
}

/** What MainActivity's AndroidNotifications bridge offers; every method may be missing (a plain browser, an older build). */
interface AndroidNotificationsBridge {
  manufacturer?: () => string;
  ignoringBatteryOptimizations?: () => boolean;
  openNotificationSettings?: () => void;
  openBatterySettings?: () => void;
  openAutostartSettings?: () => boolean;
}

function bridge(): AndroidNotificationsBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { AndroidNotifications?: AndroidNotificationsBridge }).AndroidNotifications;
}

/** Runs a bridge call that may not exist on this build; a failure is just "unknown". */
function fromBridge<T>(read: (b: AndroidNotificationsBridge) => T | undefined): T | null {
  try {
    const b = bridge();
    return b ? (read(b) ?? null) : null;
  } catch {
    return null;
  }
}

/** Boxed for the reason given in nativeNotifications.ts: a bare Capacitor plugin proxy must never be a promise's value. */
async function loadPlugin() {
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  return { plugin: LocalNotifications };
}

const UNAVAILABLE: NotificationStatus = {
  available: false,
  permission: "prompt",
  exactAlarms: false,
  channelMuted: false,
  scheduled: 0,
  batteryUnrestricted: null,
  manufacturer: null,
};

export async function readNotificationStatus(): Promise<NotificationStatus> {
  let plugin: Awaited<ReturnType<typeof loadPlugin>>["plugin"];
  try {
    plugin = (await loadPlugin()).plugin;
  } catch {
    return UNAVAILABLE;
  }

  const [permission, exact, channels, pending] = await Promise.all([
    plugin.checkPermissions().catch(() => null),
    plugin.checkExactNotificationSetting().catch(() => null),
    plugin.listChannels().catch(() => null),
    plugin.getPending().catch(() => null),
  ]);
  if (!permission) return UNAVAILABLE;

  const channel = channels?.channels?.find((c) => c.id === REMINDER_CHANNEL_ID);
  return {
    available: true,
    permission: permission.display === "granted" ? "granted" : permission.display === "denied" ? "denied" : "prompt",
    exactAlarms: exact?.exact_alarm === "granted",
    // Android's IMPORTANCE_NONE (0) is "blocked"; the plugin's own type only lists 1–5.
    channelMuted: channel !== undefined && (channel.importance as number | undefined) === 0,
    scheduled: pending?.notifications?.length ?? 0,
    batteryUnrestricted: fromBridge((b) => b.ignoringBatteryOptimizations?.()),
    manufacturer: fromBridge((b) => b.manufacturer?.()),
  };
}

/** Writes what the phone allows into the log (and so into the diagnostic report), once per launch and per return to the app. */
export async function recordNotificationStatus(trigger: "boot" | "resume"): Promise<void> {
  try {
    const status = await readNotificationStatus();
    if (!status.available) return;
    log.info("LOCAL_NOTIFICATION_STATUS", {
      layer: "local",
      trigger,
      permission: status.permission,
      exactAlarms: status.exactAlarms,
      channelMuted: status.channelMuted,
      scheduled: status.scheduled,
      batteryUnrestricted: status.batteryUnrestricted,
      manufacturer: status.manufacturer,
    });
  } catch {
    // A courtesy log line — every plugin call in readNotificationStatus already answers for itself.
  }
}

/**
 * The «روشن کردن» button. Asks for the permission when Android will still show its dialog; when
 * the person already refused (Android does not ask a third time) it opens the app's notification
 * settings instead, where the switch is. Once notifications are allowed every reminder that was
 * saved while they were off is handed to the system.
 */
export async function enableNotifications(): Promise<"granted" | "denied" | "settings"> {
  const status = await readNotificationStatus();
  if (status.permission === "granted") {
    rearmReminderNotifications();
    return "granted";
  }
  if (status.permission === "denied") {
    openNotificationSettings();
    return "settings";
  }
  const result = await requestNotificationPermission();
  if (result === "granted") {
    rearmReminderNotifications();
    return "granted";
  }
  return "denied";
}

/** Android 14+ keeps exact alarms off until the person allows them on the «Alarms & reminders» screen; returns whether they did. */
export async function allowExactAlarms(): Promise<boolean> {
  try {
    const { plugin } = await loadPlugin();
    const result = await plugin.changeExactNotificationSetting();
    const allowed = result.exact_alarm === "granted";
    // Reminders armed as inexact until now are re-armed as exact.
    if (allowed) rearmReminderNotifications();
    return allowed;
  } catch (err) {
    log.warn("LOCAL_NOTIFICATION_PERMISSION_FAILED", { error: err, errorCode: "NOTIF-002", layer: "local", step: "exact-alarm" });
    return false;
  }
}

export function openNotificationSettings(): void {
  fromBridge((b) => b.openNotificationSettings?.());
}

export function openBatterySettings(): void {
  fromBridge((b) => b.openBatterySettings?.());
}

/** Opens the brand's own "autostart"/"protected apps" screen when the phone has one; false when there is none to open. */
export function openAutostartSettings(): boolean {
  return fromBridge((b) => b.openAutostartSettings?.()) === true;
}
