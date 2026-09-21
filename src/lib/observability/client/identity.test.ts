import { describe, expect, it } from "vitest";
import { isId } from "../core/ids";
import { DEVICE_ID_KEY, loadDeviceIdentity, osVersionFromUserAgent, type KeyValueStore } from "./identity";

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value) {
      values.set(key, value);
    },
  };
}

const WEBVIEW = "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.122 Mobile Safari/537.36";

describe("osVersionFromUserAgent", () => {
  it("keeps the Android major version and drops the phone model and build", () => {
    expect(osVersionFromUserAgent(WEBVIEW)).toBe("Android 14");
    expect(osVersionFromUserAgent(WEBVIEW)).not.toMatch(/SM-|Build|UP1A/);
    expect(osVersionFromUserAgent("Mozilla/5.0 (Linux; Android 8.1.0; Nexus 5X) Chrome/80")).toBe("Android 8");
  });

  it("says nothing for a browser that is not Android", () => {
    expect(osVersionFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126")).toBeUndefined();
    expect(osVersionFromUserAgent(undefined)).toBeUndefined();
  });
});

describe("loadDeviceIdentity", () => {
  it("makes a random device id on the first launch and stores it", async () => {
    const store = memoryStore();
    const identity = await loadDeviceIdentity({ store, userAgent: WEBVIEW, timeZone: "Asia/Tehran" });
    expect(isId(identity.deviceId, "dev")).toBe(true);
    expect(identity).toMatchObject({ created: true, osVersion: "Android 14", tz: "Asia/Tehran" });
    expect(store.values.get(DEVICE_ID_KEY)).toBe(identity.deviceId);
  });

  it("keeps the same id on every later launch", async () => {
    const store = memoryStore();
    const first = await loadDeviceIdentity({ store, userAgent: WEBVIEW });
    const second = await loadDeviceIdentity({ store, userAgent: WEBVIEW });
    expect(second.deviceId).toBe(first.deviceId);
    expect(second.created).toBe(false);
  });

  it("replaces a stored value that is not an id", async () => {
    const store = memoryStore({ [DEVICE_ID_KEY]: "garbage" });
    const identity = await loadDeviceIdentity({ store });
    expect(isId(identity.deviceId, "dev")).toBe(true);
    expect(identity.created).toBe(true);
    expect(store.values.get(DEVICE_ID_KEY)).toBe(identity.deviceId);
  });

  it("still gives an id for this launch when the preferences cannot be read or written", async () => {
    const broken: KeyValueStore = {
      async get() {
        throw new Error("preferences unavailable");
      },
      async set() {
        throw new Error("preferences unavailable");
      },
    };
    const identity = await loadDeviceIdentity({ store: broken });
    expect(isId(identity.deviceId, "dev")).toBe(true);
  });

  it("is a random value, not something derived from the phone: two installations differ", async () => {
    const a = await loadDeviceIdentity({ store: memoryStore(), userAgent: WEBVIEW });
    const b = await loadDeviceIdentity({ store: memoryStore(), userAgent: WEBVIEW });
    expect(a.deviceId).not.toBe(b.deviceId);
  });
});
