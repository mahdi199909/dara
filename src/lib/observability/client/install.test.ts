import { afterEach, describe, expect, it } from "vitest";
import { MemorySink } from "../core/sink";
import { createTestLogger } from "../testing";
import { getClientDeviceId, setClientDeviceId, setClientUser } from "./clientContext";
import { ACTIVE_LOG_FILE } from "../core/rotatingFileSink";
import { getClientLogging, installClientLogging, type ClientLogging } from "./install";
import { MemoryLogFileStore } from "../core/logFileStore";

const WEBVIEW = "Mozilla/5.0 (Linux; Android 14; SM-S918B; wv) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36";

function fakeTargets() {
  const listeners = new Map<string, Array<(event?: any) => void>>();
  const target = {
    visibilityState: "visible",
    addEventListener(type: string, listener: (event?: any) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type: string, listener: (event?: any) => void) {
      listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== listener));
    },
    fire(type: string, event?: object) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    count: (type: string) => (listeners.get(type) ?? []).length,
  };
  return target;
}

let installed: ClientLogging | undefined;
afterEach(() => {
  installed?.dispose();
  installed = undefined;
  setClientDeviceId(undefined);
});

async function install() {
  const test = createTestLogger();
  const store = new MemoryLogFileStore();
  const document = fakeTargets();
  const window = fakeTargets();
  const keyValue = new Map<string, string>();
  const problems: string[] = [];
  installed = await installClientLogging({
    core: test.core,
    store,
    keyValue: { get: async (key) => keyValue.get(key) ?? null, set: async (key, value) => void keyValue.set(key, value) },
    userAgent: WEBVIEW,
    timeZone: "Asia/Tehran",
    document,
    window,
    capacitorPause: false,
    onInternalProblem: (message) => problems.push(message),
  });
  return { ...test, store, document, window, keyValue, problems, handle: installed };
}

const fileRecords = async (handle: ClientLogging) => (await handle.flush(), handle.sink.readRecent());

describe("installClientLogging", () => {
  it("stamps every record with the device id, the Android version and the time zone", async () => {
    const { logger, sink, handle } = await install();
    logger.info("SYNC_STARTED", { trigger: "resume" });
    expect(sink.last()).toMatchObject({ device_id: handle.identity.deviceId, os_version: "Android 14", tz: "Asia/Tehran" });
    expect(getClientDeviceId()).toBe(handle.identity.deviceId);
  });

  it("writes what was logged to the phone's own file once flushed", async () => {
    const { logger, handle, store } = await install();
    logger.info("SYNC_STARTED", { trigger: "resume" });
    logger.warn("SYNC_FAILED", { errorCode: "SYNC-001" });
    const records = await fileRecords(handle);
    expect(records.map((record) => record.event)).toEqual(["SYNC_STARTED", "SYNC_FAILED"]);
    expect(store.files.has(ACTIVE_LOG_FILE)).toBe(true);
  });

  it("writes the queue out when the app is hidden, and when the page is closed", async () => {
    const { logger, document, window, store } = await install();
    logger.info("SYNC_STARTED", { trigger: "resume" });
    expect(store.files.has(ACTIVE_LOG_FILE)).toBe(false); // nothing is written on the caller's path
    document.visibilityState = "hidden";
    document.fire("visibilitychange");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.files.has(ACTIVE_LOG_FILE)).toBe(true);

    logger.info("SYNC_SUCCESS", {});
    window.fire("pagehide");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const text = new TextDecoder().decode(store.files.get(ACTIVE_LOG_FILE)!.data);
    expect(text).toContain("SYNC_SUCCESS");
  });

  it("does not flush just because the app became visible", async () => {
    const { logger, document, store } = await install();
    logger.info("SYNC_STARTED", {});
    document.visibilityState = "visible";
    document.fire("visibilitychange");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.files.has(ACTIVE_LOG_FILE)).toBe(false);
  });

  it("starts writing down errors nobody catches", async () => {
    const { window, handle } = await install();
    window.fire("error", { error: new Error("nobody caught this"), message: "nobody caught this" });
    const records = await fileRecords(handle);
    expect(records.find((record) => record.event === "SYSTEM_UNHANDLED_ERROR")).toMatchObject({ level: "CRITICAL", device_id: handle.identity.deviceId });
  });

  it("installs once: a second call hands back the same logging", async () => {
    const { handle } = await install();
    const again = await installClientLogging({ core: createTestLogger().core, capacitorPause: false });
    expect(again).toBe(handle);
    expect(getClientLogging()).toBe(handle);
  });

  it("removes its sink and listeners on dispose", async () => {
    const { core, document, window, handle } = await install();
    expect(core.sinkNames()).toContain(handle.batching.name);
    handle.dispose();
    installed = undefined;
    expect(core.sinkNames()).not.toContain(handle.batching.name);
    expect(document.count("visibilitychange") + window.count("pagehide") + window.count("error")).toBe(0);
    expect(getClientLogging()).toBeUndefined();
  });

  it("keeps working, and says so once, when the log file cannot be written", async () => {
    const { logger, store, handle, problems } = await install();
    store.faults.always = { append: new Error("No space left on device") };
    for (let i = 0; i < 20; i++) logger.info("SYNC_STARTED", { i });
    await handle.flush();
    await handle.flush();
    expect(problems.length).toBeGreaterThan(0);
    expect(() => logger.info("SYNC_STARTED", {})).not.toThrow();
  });
});

describe("the account the records belong to", () => {
  it("is added when the phone is linked and removed when it signs out", async () => {
    const { logger, sink, core } = await install();
    setClientUser("cmuaqrrll00004c75p5cp5r7a", core);
    logger.info("SYNC_STARTED", {});
    expect(sink.last()?.user_id).toBe("cmuaqrrll00004c75p5cp5r7a");
    setClientUser(undefined, core);
    logger.info("SYNC_STARTED", {});
    expect(sink.last()?.user_id).toBeUndefined();
  });
});

describe("nothing here ever needs a device", () => {
  it("has no side effects when never installed (the web app, a test)", () => {
    expect(getClientLogging()).toBeUndefined();
    expect(getClientDeviceId()).toBeUndefined();
    expect(new MemorySink().records).toEqual([]);
  });
});
