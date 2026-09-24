// How reminders are handed to the operating system: which channel, exact or inexact alarm, when a
// call is skipped, and that the plugin is only ever asked one thing at a time.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A real Capacitor plugin is a proxy that answers to every property name, `then` included; a promise that
// resolves with the bare plugin would call it like a thenable and never settle. This mock is thenable the same
// way (and never resolves), so code that lets the plugin travel through a promise hangs here as well.
const plugin = vi.hoisted(() => ({
  then: vi.fn(),
  requestPermissions: vi.fn(),
  checkPermissions: vi.fn(),
  checkExactNotificationSetting: vi.fn(),
  createChannel: vi.fn(),
  schedule: vi.fn(),
  update: vi.fn(),
  cancel: vi.fn(),
  getPending: vi.fn(),
}));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: plugin }));

import { installMemoryLogger } from "@/lib/observability/testing";
import {
  REMINDER_CHANNEL_ID,
  TEST_NOTIFICATION_ID,
  cancelReminderNotification,
  requestNotificationPermission,
  rescheduleReminderNotification,
  resetNativeNotificationsForTests,
  scheduleReminderNotification,
  sendTestNotification,
  syncScheduledReminderNotifications,
} from "./nativeNotifications";

let memory: ReturnType<typeof installMemoryLogger>;
beforeEach(() => {
  memory = installMemoryLogger({ level: "TRACE" });
  for (const fn of Object.values(plugin)) fn.mockReset().mockResolvedValue(undefined);
  plugin.getPending.mockResolvedValue({ notifications: [] });
  plugin.checkPermissions.mockResolvedValue({ display: "granted" });
  plugin.checkExactNotificationSetting.mockResolvedValue({ exact_alarm: "denied" });
  resetNativeNotificationsForTests();
});
afterEach(() => memory.restore());

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();
const reminder = (id: string, remindAt = inAnHour()) => ({ id, title: "عنوان", body: "متن", remindAt });

/** The one notification a schedule() call carried. */
function scheduledOnce() {
  expect(plugin.schedule).toHaveBeenCalledTimes(1);
  const [{ notifications }] = plugin.schedule.mock.calls[0];
  expect(notifications).toHaveLength(1);
  return notifications[0];
}

describe("the reminders channel", () => {
  it("creates one high-importance channel — once, however many reminders follow — and schedules onto it", async () => {
    scheduleReminderNotification(reminder("a"));
    scheduleReminderNotification(reminder("b"));
    await settle();

    expect(plugin.createChannel).toHaveBeenCalledTimes(1);
    // PRIVATE on the lock screen: the plugin's own channel default is PUBLIC, which would show event titles and installment amounts to anyone holding the phone.
    expect(plugin.createChannel.mock.calls[0][0]).toMatchObject({ id: REMINDER_CHANNEL_ID, importance: 4, visibility: 0, vibration: true });
    expect(plugin.schedule).toHaveBeenCalledTimes(2);
    for (const [{ notifications }] of plugin.schedule.mock.calls) expect(notifications[0].channelId).toBe(REMINDER_CHANNEL_ID);
  });

  it("still schedules — on the default channel — when the channel cannot be created, and tries again next time", async () => {
    plugin.createChannel.mockRejectedValueOnce(new Error("channels unavailable"));
    scheduleReminderNotification(reminder("a"));
    await settle();
    expect(scheduledOnce().channelId).toBeUndefined();
    expect(memory.sink.find("LOCAL_NOTIFICATION_CHANNEL_FAILED")[0]).toMatchObject({ level: "WARN" });

    plugin.schedule.mockClear();
    scheduleReminderNotification(reminder("b"));
    await settle();
    expect(plugin.createChannel).toHaveBeenCalledTimes(2);
    expect(scheduledOnce().channelId).toBe(REMINDER_CHANNEL_ID);
  });
});

describe("a phone without notification channels (below Android 8)", () => {
  it("schedules on the default channel and neither warns nor asks again", async () => {
    plugin.createChannel.mockRejectedValue(Object.assign(new Error("not available"), { code: "UNAVAILABLE" }));
    scheduleReminderNotification(reminder("a"));
    await settle();
    scheduleReminderNotification(reminder("b"));
    await settle();

    expect(plugin.createChannel).toHaveBeenCalledTimes(1);
    expect(plugin.schedule).toHaveBeenCalledTimes(2);
    for (const [{ notifications }] of plugin.schedule.mock.calls) expect(notifications[0].channelId).toBeUndefined();
    expect(memory.sink.find("LOCAL_NOTIFICATION_CHANNEL_FAILED")).toEqual([]);
  });
});

describe("exact alarms", () => {
  it("asks for an exact alarm only when the system already allows it", async () => {
    plugin.checkExactNotificationSetting.mockResolvedValue({ exact_alarm: "granted" });
    scheduleReminderNotification(reminder("a"));
    await settle();
    expect(scheduledOnce().isExactNotification).toBe(true);
    expect(memory.sink.find("LOCAL_NOTIFICATION_SCHEDULED")[0].metadata.exact).toBe(true);
  });

  it("never asks when it is not allowed — the plugin would open a settings screen mid-save", async () => {
    scheduleReminderNotification(reminder("a"));
    await settle();
    expect(scheduledOnce().isExactNotification).toBe(false);
  });

  it("falls back to an inexact alarm when the setting cannot be read", async () => {
    plugin.checkExactNotificationSetting.mockRejectedValue(new Error("no such method"));
    scheduleReminderNotification(reminder("a"));
    await settle();
    expect(scheduledOnce().isExactNotification).toBe(false);
  });

  it("re-reads the setting each time, so a switch flipped in system settings takes effect at once", async () => {
    scheduleReminderNotification(reminder("a"));
    await settle();
    plugin.checkExactNotificationSetting.mockResolvedValue({ exact_alarm: "granted" });
    plugin.schedule.mockClear();
    scheduleReminderNotification(reminder("b"));
    await settle();
    expect(scheduledOnce().isExactNotification).toBe(true);
  });

  it("rings with the device idle, and at the moment the reminder is due", async () => {
    const at = inAnHour();
    scheduleReminderNotification(reminder("a", at));
    await settle();
    const notification = scheduledOnce();
    expect(notification.schedule.allowWhileIdle).toBe(true);
    expect(new Date(notification.schedule.at).toISOString()).toBe(at);
  });
});

describe("moving a reminder", () => {
  it("schedules it again instead of updating — update() ignores a reminder the plugin never knew, so one that was skipped as already-due and then moved into the future would never ring", async () => {
    rescheduleReminderNotification(reminder("a"));
    await settle();
    expect(plugin.update).not.toHaveBeenCalled();
    expect(scheduledOnce().channelId).toBe(REMINDER_CHANNEL_ID);
    expect(memory.sink.find("LOCAL_NOTIFICATION_RESCHEDULED")).toHaveLength(1);
  });

  it("cancels it instead when the new moment has already passed", async () => {
    rescheduleReminderNotification(reminder("a", new Date(Date.now() - 1000).toISOString()));
    await settle();
    expect(plugin.schedule).not.toHaveBeenCalled();
    expect(plugin.cancel).toHaveBeenCalledTimes(1);
  });

  it("uses the same notification id for the same reminder every time", async () => {
    scheduleReminderNotification(reminder("same-reminder"));
    rescheduleReminderNotification(reminder("same-reminder"));
    cancelReminderNotification("same-reminder");
    await settle();
    const ids = [plugin.schedule.mock.calls[0][0].notifications[0].id, plugin.schedule.mock.calls[1][0].notifications[0].id, plugin.cancel.mock.calls[0][0].notifications[0].id];
    expect(new Set(ids).size).toBe(1);
    expect(Number.isInteger(ids[0]) && Math.abs(ids[0]) <= 2_147_483_647).toBe(true);
  });
});

describe("reconciling with the database", () => {
  it("does nothing while notifications are not allowed — and so never pops the permission dialog behind the person's back", async () => {
    plugin.checkPermissions.mockResolvedValue({ display: "denied" });
    syncScheduledReminderNotifications([reminder("a")]);
    await settle();
    expect(plugin.getPending).not.toHaveBeenCalled();
    expect(plugin.schedule).not.toHaveBeenCalled();
    expect(memory.sink.find("LOCAL_NOTIFICATION_SKIPPED")[0]).toMatchObject({ metadata: { wanted: 1 } });
  });

  it("does nothing either while the permission has never been decided", async () => {
    plugin.checkPermissions.mockResolvedValue({ display: "prompt" });
    syncScheduledReminderNotifications([reminder("a")]);
    await settle();
    expect(plugin.schedule).not.toHaveBeenCalled();
  });

  it("schedules every wanted reminder in one call, with the channel and the alarm type", async () => {
    plugin.checkExactNotificationSetting.mockResolvedValue({ exact_alarm: "granted" });
    syncScheduledReminderNotifications([reminder("a"), reminder("b"), reminder("c")]);
    await settle();
    expect(plugin.schedule).toHaveBeenCalledTimes(1);
    const { notifications } = plugin.schedule.mock.calls[0][0];
    expect(notifications).toHaveLength(3);
    expect(notifications.every((n: { channelId: string; isExactNotification: boolean }) => n.channelId === REMINDER_CHANNEL_ID && n.isExactNotification)).toBe(true);
  });

  it("cancels what is pending but no longer wanted — and leaves the test notification alone", async () => {
    plugin.getPending.mockResolvedValue({ notifications: [{ id: 5 }, { id: TEST_NOTIFICATION_ID }] });
    syncScheduledReminderNotifications([]);
    await settle();
    expect(plugin.cancel).toHaveBeenCalledTimes(1);
    expect(plugin.cancel.mock.calls[0][0]).toEqual({ notifications: [{ id: 5 }] });
  });

  it("schedules nothing when nothing is wanted", async () => {
    syncScheduledReminderNotifications([]);
    await settle();
    expect(plugin.schedule).not.toHaveBeenCalled();
    expect(memory.sink.find("LOCAL_NOTIFICATION_RECONCILED")[0]).toMatchObject({ metadata: { wanted: 0 } });
  });
});

describe("one thing at a time", () => {
  it("runs a reconcile only after a reminder scheduled before it has finished — otherwise it would cancel that brand-new alarm as stale", async () => {
    const order: string[] = [];
    plugin.schedule.mockImplementation(async () => {
      order.push("schedule:start");
      await new Promise((resolve) => setTimeout(resolve, 25));
      order.push("schedule:end");
    });
    plugin.getPending.mockImplementation(async () => {
      order.push("getPending");
      return { notifications: [] };
    });

    scheduleReminderNotification(reminder("fresh"));
    syncScheduledReminderNotifications([]);
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(order.slice(0, 3)).toEqual(["schedule:start", "schedule:end", "getPending"]);
  });

  it("keeps going after one call failed", async () => {
    plugin.cancel.mockRejectedValueOnce(new Error("boom"));
    cancelReminderNotification("a");
    scheduleReminderNotification(reminder("b"));
    await settle();
    expect(memory.sink.find("LOCAL_NOTIFICATION_FAILED")).toHaveLength(1);
    expect(plugin.schedule).toHaveBeenCalledTimes(1);
  });
});

describe("requestNotificationPermission", () => {
  it("says granted", async () => {
    plugin.requestPermissions.mockResolvedValue({ display: "granted" });
    await expect(requestNotificationPermission()).resolves.toBe("granted");
    expect(memory.sink.find("LOCAL_NOTIFICATION_PERMISSION_FAILED")).toEqual([]);
  });

  it("says denied — and writes it down, where a refusal used to leave no trace at all", async () => {
    plugin.requestPermissions.mockResolvedValue({ display: "denied" });
    await expect(requestNotificationPermission()).resolves.toBe("denied");
    expect(memory.sink.find("LOCAL_NOTIFICATION_PERMISSION_FAILED")[0]).toMatchObject({ level: "WARN", error_code: "NOTIF-002", metadata: { permission: "denied" } });
  });

  it("says unavailable when there is no plugin to ask", async () => {
    plugin.requestPermissions.mockRejectedValue(new Error("not implemented on web"));
    await expect(requestNotificationPermission()).resolves.toBe("unavailable");
  });
});

describe("sendTestNotification", () => {
  it("rings a test on the same channel and alarm type as a real reminder, at the delay asked", async () => {
    plugin.checkExactNotificationSetting.mockResolvedValue({ exact_alarm: "granted" });
    const before = Date.now();
    const result = await sendTestNotification({ title: "t", body: "b", delaySeconds: 60 });

    const notification = scheduledOnce();
    expect(notification).toMatchObject({ id: TEST_NOTIFICATION_ID, channelId: REMINDER_CHANNEL_ID, isExactNotification: true });
    expect(result.exact).toBe(true);
    expect(result.at.getTime()).toBeGreaterThanOrEqual(before + 60_000);
    expect(result.at.getTime()).toBeLessThan(before + 62_000);
    expect(memory.sink.find("LOCAL_NOTIFICATION_TEST_SENT")).toHaveLength(1);
  });

  it("tells its caller — a person waiting on the button — when it could not be scheduled", async () => {
    plugin.schedule.mockRejectedValue(new Error("Notifications are not enabled on this device."));
    await expect(sendTestNotification({ title: "t", body: "b", delaySeconds: 3 })).rejects.toThrow("not enabled");
    expect(memory.sink.find("LOCAL_NOTIFICATION_FAILED")[0]).toMatchObject({ level: "ERROR", error_code: "NOTIF-001", operation: "test" });
  });

  it("uses an id no reminder can hold in a reconcile's stale list", () => {
    expect(Number.isInteger(TEST_NOTIFICATION_ID) && TEST_NOTIFICATION_ID <= 2_147_483_647).toBe(true);
  });
});
