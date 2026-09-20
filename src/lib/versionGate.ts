// Update gate for the Android app — see the AppRelease model, /admin and src/lib/appVersion.ts.
// Deliberately stored in Capacitor Preferences rather than the on-device SQLite DB: this has nothing to do
// with user data or sync, it's a tiny piece of app-level state, so it doesn't need a table,
// migrations, or to survive a "clear app data" the way real user data must.
import { Preferences } from "@capacitor/preferences";
import { fetchRemoteAppVersion, type RemoteLicenseStatus } from "./remoteAuth";
import { versionNameFromCode } from "./appVersion";

const KEY = "parva_version_gate";

export interface VersionGateCache {
  latestVersionCode: number | null;
  // Absent in caches written by builds that predate the public update check.
  latestVersionName?: string | null;
  minSupportedVersionCode: number | null;
  downloadUrl: string | null;
}

async function saveVersionGate(data: VersionGateCache): Promise<void> {
  await Preferences.set({ key: KEY, value: JSON.stringify(data) });
}

// The license-status refresh (needs a login) carries the same fields; either source may write the
// cache, and the server answers both from one place, so whichever lands last is still correct.
export async function cacheVersionGate(status: RemoteLicenseStatus): Promise<void> {
  await saveVersionGate({
    latestVersionCode: status.latestVersionCode,
    latestVersionName: status.latestVersionName ?? null,
    minSupportedVersionCode: status.minSupportedVersionCode,
    downloadUrl: status.downloadUrl,
  });
}

/**
 * Asks the server what the newest release is (GET /api/app/version — no login needed, so it also
 * reaches phones that only ever worked offline) and caches the answer for checkVersionGate.
 * Never throws: offline or a slow server just leaves the last cached answer in place.
 */
export async function refreshVersionGate(): Promise<boolean> {
  try {
    const release = await fetchRemoteAppVersion();
    await saveVersionGate({
      latestVersionCode: release.latestVersionCode,
      latestVersionName: release.latestVersionName,
      minSupportedVersionCode: release.minSupportedVersionCode,
      downloadUrl: release.downloadUrl,
    });
    return true;
  } catch {
    return false;
  }
}

async function getCachedVersionGate(): Promise<VersionGateCache | null> {
  const { value } = await Preferences.get({ key: KEY });
  return value ? (JSON.parse(value) as VersionGateCache) : null;
}

export type VersionGateResult =
  | { blocked: false; updateAvailable: false }
  | { blocked: false; updateAvailable: true; downloadUrl: string; latestVersionCode: number; latestVersionName: string | null }
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
  // Strictly older than the newest release: a build that is somehow ahead of what the server
  // announces (a test build) must never be told to "update" back to an older download.
  if (currentBuild < cached.latestVersionCode) {
    return {
      blocked: false,
      updateAvailable: true,
      downloadUrl: cached.downloadUrl || "",
      latestVersionCode: cached.latestVersionCode,
      latestVersionName: cached.latestVersionName ?? versionNameFromCode(cached.latestVersionCode),
    };
  }
  return { blocked: false, updateAvailable: false };
}
