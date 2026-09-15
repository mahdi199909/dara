// Forced-update gate for the Android app — see the AppRelease model and /admin. Deliberately
// stored in Capacitor Preferences rather than the on-device SQLite DB: this has nothing to do
// with user data or sync, it's a tiny piece of app-level state, so it doesn't need a table,
// migrations, or to survive a "clear app data" the way real user data must.
import { Preferences } from "@capacitor/preferences";
import type { RemoteLicenseStatus } from "./remoteAuth";

const KEY = "parva_version_gate";

export interface VersionGateCache {
  latestVersionCode: number | null;
  minSupportedVersionCode: number | null;
  downloadUrl: string | null;
}

export async function cacheVersionGate(status: RemoteLicenseStatus): Promise<void> {
  const data: VersionGateCache = {
    latestVersionCode: status.latestVersionCode,
    minSupportedVersionCode: status.minSupportedVersionCode,
    downloadUrl: status.downloadUrl,
  };
  await Preferences.set({ key: KEY, value: JSON.stringify(data) });
}

async function getCachedVersionGate(): Promise<VersionGateCache | null> {
  const { value } = await Preferences.get({ key: KEY });
  return value ? (JSON.parse(value) as VersionGateCache) : null;
}

export type VersionGateResult =
  | { blocked: false; updateAvailable: false }
  | { blocked: false; updateAvailable: true; downloadUrl: string }
  | { blocked: true; downloadUrl: string };

// currentBuild comes from @capacitor/app's App.getInfo().build (Android versionCode as a
// string) — read at the call site rather than here, since importing @capacitor/app in a module
// that's also reached from web-only code paths would break the web build's isNativePlatform()
// guard pattern used everywhere else in this codebase.
export async function checkVersionGate(currentBuild: number): Promise<VersionGateResult> {
  const cached = await getCachedVersionGate();
  if (!cached || cached.minSupportedVersionCode === null || cached.latestVersionCode === null) {
    return { blocked: false, updateAvailable: false };
  }
  if (currentBuild < cached.minSupportedVersionCode) {
    return { blocked: true, downloadUrl: cached.downloadUrl || "" };
  }
  if (currentBuild < cached.latestVersionCode) {
    return { blocked: false, updateAvailable: true, downloadUrl: cached.downloadUrl || "" };
  }
  return { blocked: false, updateAvailable: false };
}
