// What the Settings card and the banner are told about this phone's notifications, and what each
// button does. The plugin and the AndroidNotifications bridge are stubbed: this pins the reading of
// their answers (a muted channel, a refused permission), not Android itself.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A real Capacitor plugin is a proxy that answers to every property name, `then` included; a promise that
// resolves with the bare plugin would call it like a thenable and never settle. This mock is thenable the same
// way (and never resolves), so code that lets the plugin travel through a promise hangs here as well.
const plugin = vi.hoisted(() => ({
  then: vi.fn(),
  requestPermissions: vi.fn(),
  checkPermissions: vi.fn(),
  checkExactNotificationSetting: vi.fn(),
  changeExactNotificationSetting: vi.fn(),
  listChannels: vi.fn(),
  getPending: vi.fn(),
  createChannel: vi.fn(),
  schedule: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: plugin }));

const rearm = vi.hoisted(() => vi.fn());
vi.mock("./reminderNotifications", () => ({ rearmReminderNotifications: rearm }));

import { installMemoryLogger } from "@/lib/observability/testing";
import { REMINDER_CHANNEL_ID } from "./nativeNotifications";
import {
  allowExactAlarms,
  enableNotifications,
  openAutostartSettings,
  openBatterySettings,
  openNotificationSettings,
  readNotificationStatus,
  recordNotificationStatus,
} from "./notificationStatus";

let memory: ReturnType<typeof installMemoryLogger>;
beforeEach(() => {
  memory = installMemoryLogger({ level: "TRACE" });
  for (const fn of Object.values(plugin)) fn.mockReset().mockResolvedValue(undefined);
  rearm.mockReset();
  plugin.checkPermissions.mockResolvedValue({ display: "granted" });
  plugin.checkExactNotificationSetting.mockResolvedValue({ exact_alarm: "granted" });
  plugin.listChannels.mockResolvedValue({ channels: [{ id: REMINDER_CHANNEL_ID, name: "n", importance: 4 }] });
  plugin.getPending.mockResolvedValue({ notifications: [{ id: 1 }, { id: 2 }, { id: 3 }] });
});
afterEach(() => {
  memory.restore();
  vi.unstubAllGlobals();
});

function stubBridge(bridge: Record<string, unknown>) {
  vi.stubGlobal("window", { AndroidNotifications: bridge });
}

describe("readNotificationStatus", () => {
  it("reads a fully working phone", async () => {
    stubBridge({ manufacturer: () => "google", ignoringBatteryOptimizations: () => true });
    await expect(readNotificationStatus()).resolves.toEqual({
      available: true,
      permission: "granted",
      exactAlarms: true,
      channelMuted: false,
      scheduled: 3,
      batteryUnrestricted: true,
      manufacturer: "google",
    });
  });

  it("tells a refused permission from one that was never asked", async () => {
    plugin.checkPermissions.mockResolvedValue({ display: "denied" });
    expect((await readNotificationStatus()).permission).toBe("denied");
    plugin.checkPermissions.mockResolvedValue({ display: "prompt" });
    expect((await readNotificationStatus()).permission).toBe("prompt");
    plugin.checkPermissions.mockResolvedValue({ display: "prompt-with-rationale" });
    expect((await readNotificationStatus()).permission).toBe("prompt");
  });

  it("notices when the person muted the reminders channel although notifications are allowed", async () => {
    plugin.listChannels.mockResolvedValue({ channels: [{ id: REMINDER_CHANNEL_ID, name: "n", importance: 0 }] });
    const status = await readNotificationStatus();
    expect(status.permission).toBe("granted");
    expect(status.channelMuted).toBe(true);
  });

  it("does not call a channel muted that has not been created yet, or belongs to something else", async () => {
    plugin.listChannels.mockResolvedValue({ channels: [{ id: "default", name: "n", importance: 0 }] });
    expect((await readNotificationStatus()).channelMuted).toBe(false);
  });

  it("reports exact alarms as off when the system has not allowed them", async () => {
    plugin.checkExactNotificationSetting.mockResolvedValue({ exact_alarm: "denied" });
    expect((await readNotificationStatus()).exactAlarms).toBe(false);
  });

  it("leaves battery and brand unknown when the phone has no bridge (an older build)", async () => {
    const status = await readNotificationStatus();
    expect(status.batteryUnrestricted).toBeNull();
    expect(status.manufacturer).toBeNull();
  });

  it("still answers when one of the plugin calls fails", async () => {
    plugin.listChannels.mockRejectedValue(new Error("unavailable below Android 8"));
    plugin.getPending.mockRejectedValue(new Error("boom"));
    const status = await readNotificationStatus();
    expect(status).toMatchObject({ available: true, permission: "granted", channelMuted: false, scheduled: 0 });
  });

  it("is unavailable when the plugin cannot even report the permission (a plain browser)", async () => {
    plugin.checkPermissions.mockRejectedValue(new Error("not implemented on web"));
    expect((await readNotificationStatus()).available).toBe(false);
  });
});

describe("recordNotificationStatus", () => {
  it("writes what the phone allows into the log — nothing personal in it", async () => {
    stubBridge({ manufacturer: () => "xiaomi", ignoringBatteryOptimizations: () => false });
    await recordNotificationStatus("boot");
    expect(memory.sink.find("LOCAL_NOTIFICATION_STATUS")[0]).toMatchObject({
      level: "INFO",
      metadata: { trigger: "boot", permission: "granted", exactAlarms: true, channelMuted: false, scheduled: 3, batteryUnrestricted: false, manufacturer: "xiaomi" },
    });
  });

  it("writes nothing outside the Android app", async () => {
    plugin.checkPermissions.mockRejectedValue(new Error("not implemented on web"));
    await recordNotificationStatus("resume");
    expect(memory.sink.find("LOCAL_NOTIFICATION_STATUS")).toEqual([]);
  });
});

describe("enableNotifications", () => {
  it("re-arms the reminders when notifications are already on", async () => {
    await expect(enableNotifications()).resolves.toBe("granted");
    expect(rearm).toHaveBeenCalledTimes(1);
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });

  it("asks for the permission when Android will still show its dialog, then re-arms", async () => {
    plugin.checkPermissions.mockResolvedValue({ display: "prompt" });
    plugin.requestPermissions.mockResolvedValue({ display: "granted" });
    await expect(enableNotifications()).resolves.toBe("granted");
    expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
    expect(rearm).toHaveBeenCalledTimes(1);
  });

  it("says denied — and re-arms nothing — when the person refuses the dialog", async () => {
    plugin.checkPermissions.mockResolvedValue({ display: "prompt" });
    plugin.requestPermissions.mockResolvedValue({ display: "denied" });
    await expect(enableNotifications()).resolves.toBe("denied");
    expect(rearm).not.toHaveBeenCalled();
  });

  it("opens the app's notification settings when it was refused before — Android will not ask again", async () => {
    plugin.checkPermissions.mockResolvedValue({ display: "denied" });
    const openNotificationSettingsSpy = vi.fn();
    stubBridge({ openNotificationSettings: openNotificationSettingsSpy });
    await expect(enableNotifications()).resolves.toBe("settings");
    expect(openNotificationSettingsSpy).toHaveBeenCalledTimes(1);
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });
});

describe("allowExactAlarms", () => {
  it("re-arms every reminder as exact once the person allowed it", async () => {
    plugin.changeExactNotificationSetting.mockResolvedValue({ exact_alarm: "granted" });
    await expect(allowExactAlarms()).resolves.toBe(true);
    expect(rearm).toHaveBeenCalledTimes(1);
  });

  it("re-arms nothing when they came back without allowing it", async () => {
    plugin.changeExactNotificationSetting.mockResolvedValue({ exact_alarm: "denied" });
    await expect(allowExactAlarms()).resolves.toBe(false);
    expect(rearm).not.toHaveBeenCalled();
  });

  it("says false, and logs, when the settings screen cannot be opened", async () => {
    plugin.changeExactNotificationSetting.mockRejectedValue(new Error("no activity"));
    await expect(allowExactAlarms()).resolves.toBe(false);
    expect(memory.sink.find("LOCAL_NOTIFICATION_PERMISSION_FAILED")).toHaveLength(1);
  });
});

describe("the system screens", () => {
  it("opens each through the bridge", () => {
    const bridge = { openNotificationSettings: vi.fn(), openBatterySettings: vi.fn(), openAutostartSettings: vi.fn(() => true) };
    stubBridge(bridge);
    openNotificationSettings();
    openBatterySettings();
    expect(openAutostartSettings()).toBe(true);
    expect(bridge.openNotificationSettings).toHaveBeenCalledTimes(1);
    expect(bridge.openBatterySettings).toHaveBeenCalledTimes(1);
    expect(bridge.openAutostartSettings).toHaveBeenCalledTimes(1);
  });

  it("does nothing, and does not throw, without a bridge", () => {
    expect(() => {
      openNotificationSettings();
      openBatterySettings();
    }).not.toThrow();
    expect(openAutostartSettings()).toBe(false);
  });

  it("survives a bridge that throws", () => {
    stubBridge({
      openBatterySettings: () => {
        throw new Error("bridge down");
      },
    });
    expect(() => openBatterySettings()).not.toThrow();
  });
});
