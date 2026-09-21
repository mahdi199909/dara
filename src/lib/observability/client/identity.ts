// Who is logging, on a phone: a random id for this installation, a coarse Android version and the person's time
// zone. The device id is NOT a hardware id — it is a random value made on first launch and kept in the app's own
// preferences, so it says "this installation" and nothing about the phone, and it disappears with the app. It ties
// a phone's own log lines to the server's records of the requests that phone made (the X-Parva-Device-Id header).
import { isId, newId } from "../core/ids";

export const DEVICE_ID_KEY = "parva_device_id";

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/** The app's private key-value storage (Capacitor Preferences), imported only when it is needed. */
export function createPreferencesStore(): KeyValueStore {
  return {
    async get(key) {
      const { Preferences } = await import("@capacitor/preferences");
      return (await Preferences.get({ key })).value;
    },
    async set(key, value) {
      const { Preferences } = await import("@capacitor/preferences");
      await Preferences.set({ key, value });
    },
  };
}

export interface DeviceIdentity {
  deviceId: string;
  osVersion?: string;
  tz?: string;
  /** True when this launch made the id (a first launch, or the stored one was unusable). */
  created: boolean;
}

/**
 * "Android 14" out of the WebView's user agent — the major version only. The model and build number that
 * follow it in the same string are left out on purpose: they narrow a person down and no bug needs them.
 */
export function osVersionFromUserAgent(userAgent: string | undefined): string | undefined {
  const match = userAgent ? /Android (\d+)/.exec(userAgent) : null;
  return match ? `Android ${match[1]}` : undefined;
}

export function currentTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export async function loadDeviceIdentity(options: { store?: KeyValueStore; userAgent?: string; timeZone?: string } = {}): Promise<DeviceIdentity> {
  const store = options.store ?? createPreferencesStore();
  const userAgent = options.userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : undefined);
  const base = { osVersion: osVersionFromUserAgent(userAgent), tz: options.timeZone ?? currentTimeZone() };

  let stored: string | null = null;
  try {
    stored = await store.get(DEVICE_ID_KEY);
  } catch {
    // unreadable preferences: fall through and use an id for this launch only
  }
  if (isId(stored, "dev")) return { deviceId: stored as string, created: false, ...base };

  const deviceId = newId("dev");
  try {
    await store.set(DEVICE_ID_KEY, deviceId);
  } catch {
    // the id then lasts only until the app is closed — still enough to correlate one session's lines
  }
  return { deviceId, created: true, ...base };
}
