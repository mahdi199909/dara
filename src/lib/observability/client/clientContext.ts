// What a phone's log lines know about the phone: filled in once at launch (the device id, the Android version,
// the time zone) and updated when the person signs in or out (the account the lines belong to). Kept apart from
// the Capacitor-dependent code so the sync and network modules can read the device id without importing it.
import { getRootCore } from "../root";
import type { LoggerCore } from "../core/logger";

let deviceId: string | undefined;

/** The id of this installation, once known (the app sets it at launch); undefined before that and on the web. */
export function getClientDeviceId(): string | undefined {
  return deviceId;
}

export function setClientDeviceId(value: string | undefined): void {
  deviceId = value;
}

/** Stamps every later record with the device's identity. */
export function applyClientIdentity(identity: { deviceId: string; osVersion?: string; tz?: string }, core: LoggerCore = getRootCore()): void {
  deviceId = identity.deviceId;
  core.setStaticContext({ deviceId: identity.deviceId, osVersion: identity.osVersion, tz: identity.tz });
}

/**
 * Says which account the phone's records belong to: the id the SERVER knows the person by, so the same value
 * finds the server's records. Called when a sign-in links the phone, and with undefined when it signs out.
 */
export function setClientUser(userId: string | null | undefined, core: LoggerCore = getRootCore()): void {
  core.setStaticContext({ userId: userId || undefined });
}
