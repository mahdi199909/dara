// Which build of the app is this, which one is the newest, and where is it downloaded from — kept
// free of Prisma, Capacitor and the network so the web server, the Android app, the CI script
// (scripts/app-version.ts) and the tests all apply exactly the same rules.
//
// The Android versionCode is DERIVED from the human version (1.1.0 -> 10100) instead of being
// CI's run number. That way the number the server announces for a release is known before the
// APK exists, it always grows with the version, and the two can never drift apart. It needs
// minor < 100 and patch < 100, which parseVersionName enforces.
import { toPersianDigits } from "./money";

/** What the user sees as the app's name — the launcher label, the download file and the UI copy. */
export const APP_NAME = "parvaapp";

/** The one file name the APK is ever published under (GitHub Release asset and browser download). */
export const APK_FILE_NAME = `${APP_NAME}.apk`;

/** The version this bundle was built from — next.config.mjs inlines package.json's version. */
export const BUNDLE_APP_VERSION: string | null = process.env.NEXT_PUBLIC_APP_VERSION || null;

/** Permanent link people are given; next.config.mjs redirects it to the newest release's APK. */
export const APK_STATIC_PATH = `/${APK_FILE_NAME}`;
export const APK_STATIC_URL = `https://my.parvaapp.ir${APK_STATIC_PATH}`;

/** GitHub serves the newest (non-draft, non-prerelease) release's asset of this name at this URL. */
export const APK_LATEST_RELEASE_URL = `https://github.com/mahdi199909/dara/releases/latest/download/${APK_FILE_NAME}`;

/**
 * The newest APK that has been published. Bump this together with package.json's version when a
 * release is tagged (a test fails if they disagree) — and deploy the server only AFTER the tag's
 * CI run has published the APK, because from then on every older install is told to update.
 */
export const LATEST_APP_RELEASE = {
  versionName: "1.3.0",
  /** Installs below this are locked out until they update (1 = nobody is ever forced). */
  minSupportedVersionCode: 1,
} as const;

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersionName(name: string): ParsedVersion | null {
  const match = /^(\d{1,3})\.(\d{1,2})\.(\d{1,2})$/.exec(name.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function versionCodeFromName(name: string): number {
  const v = parseVersionName(name);
  if (!v) throw new Error(`Not a valid app version (expected MAJOR.MINOR.PATCH with minor/patch < 100): "${name}"`);
  return v.major * 10000 + v.minor * 100 + v.patch;
}

/** Inverse of versionCodeFromName; null for the old run-number style codes (< 10000). */
export function versionNameFromCode(code: number): string | null {
  if (!Number.isInteger(code) || code < 10000) return null;
  return `${Math.floor(code / 10000)}.${Math.floor((code % 10000) / 100)}.${code % 100}`;
}

export const LATEST_APP_VERSION_CODE = versionCodeFromName(LATEST_APP_RELEASE.versionName);

/** What GET /api/app/version and /api/license/status tell the app about the newest release. */
export interface AppReleaseInfo {
  latestVersionName: string | null;
  latestVersionCode: number;
  minSupportedVersionCode: number;
  downloadUrl: string;
}

/** The admin-editable row (see the AppRelease model and /admin); every field is a manual override. */
export interface AppReleaseRow {
  latestVersionCode: number;
  minSupportedVersionCode: number;
  downloadUrl: string;
}

/**
 * Built-in release info, optionally overridden by whatever an admin saved:
 *  - latest: the larger of the two, so a stale row can never hide a newer release shipped in code;
 *  - minimum: the row's value if there is one (a forced-update policy only an admin decides);
 *  - link: the row's if it is non-empty, otherwise the permanent static link.
 */
export function resolveAppRelease(row: AppReleaseRow | null): AppReleaseInfo {
  const latestVersionCode = Math.max(LATEST_APP_VERSION_CODE, row?.latestVersionCode ?? 0);
  const minSupportedVersionCode = Math.min(row?.minSupportedVersionCode ?? LATEST_APP_RELEASE.minSupportedVersionCode, latestVersionCode);
  return {
    latestVersionName: versionNameFromCode(latestVersionCode),
    latestVersionCode,
    minSupportedVersionCode,
    downloadUrl: row?.downloadUrl?.trim() || APK_STATIC_URL,
  };
}

/** The update banner's sentence: "نسخه جدید ۱.۱.۰ آماده‌ی دانلود است (نسخه‌ی شما: ۱.۰)." */
export function updateNoticeText(latestName: string | null, currentName: string | null): string {
  const latest = latestName ? ` ${toPersianDigits(latestName)}` : "";
  const current = currentName ? ` (نسخه‌ی شما: ${toPersianDigits(currentName)})` : "";
  return `نسخه جدید${latest} آماده‌ی دانلود است${current}.`;
}

/** "نسخه ۱.۱.۰ (ساخت ۱۰۱۰۰)" — for Settings. */
export function formatVersionLabel(name: string | null, code: number | null): string {
  if (name && code) return `نسخه ${toPersianDigits(name)} (ساخت ${toPersianDigits(code)})`;
  if (name) return `نسخه ${toPersianDigits(name)}`;
  if (code) return `ساخت ${toPersianDigits(code)}`;
  return "";
}
