import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APK_FILE_NAME,
  APK_LATEST_RELEASE_URL,
  APK_STATIC_PATH,
  APK_STATIC_URL,
  APP_NAME,
  APP_DISPLAY_NAME,
  APP_TAGLINE,
  LATEST_APP_RELEASE,
  LATEST_APP_VERSION_CODE,
  formatVersionLabel,
  parseVersionName,
  resolveAppRelease,
  updateNoticeText,
  versionCodeFromName,
  versionNameFromCode,
} from "./appVersion";

describe("version names and codes", () => {
  it("derives the Android versionCode from the version, growing with it", () => {
    expect(versionCodeFromName("1.1.0")).toBe(10100);
    expect(versionCodeFromName("1.0.0")).toBe(10000);
    expect(versionCodeFromName("2.13.7")).toBe(21307);
    const ordered = ["0.9.9", "1.0.0", "1.0.1", "1.1.0", "1.10.0", "2.0.0"].map(versionCodeFromName);
    expect([...ordered].sort((a, b) => a - b)).toEqual(ordered);
  });

  it("refuses versions the code could not represent", () => {
    for (const bad of ["1.1", "1.1.0.0", "v1.1.0", "1.100.0", "1.0.100", "a.b.c", ""]) {
      expect(parseVersionName(bad), bad).toBeNull();
      expect(() => versionCodeFromName(bad), bad).toThrow();
    }
  });

  it("turns a code back into its version, and knows the old run-number codes have none", () => {
    expect(versionNameFromCode(10100)).toBe("1.1.0");
    expect(versionNameFromCode(21307)).toBe("2.13.7");
    expect(versionNameFromCode(69)).toBeNull();
    expect(versionNameFromCode(9999)).toBeNull();
    for (const name of ["1.0.0", "1.1.0", "3.27.99"]) expect(versionNameFromCode(versionCodeFromName(name))).toBe(name);
  });

  it("treats every build made before 1.1.0 (CI run numbers) as older than 1.1.0", () => {
    expect(LATEST_APP_VERSION_CODE).toBeGreaterThan(9999);
  });
});

describe("the announced release", () => {
  it("is the version in package.json — bump both together when tagging a release", () => {
    const { version } = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { version: string };
    expect(LATEST_APP_RELEASE.versionName).toBe(version);
  });

  it("is announced with the built-in link and nobody forced to update when nothing is configured", () => {
    expect(resolveAppRelease(null)).toEqual({
      latestVersionName: LATEST_APP_RELEASE.versionName,
      latestVersionCode: LATEST_APP_VERSION_CODE,
      minSupportedVersionCode: 1,
      downloadUrl: APK_STATIC_URL,
    });
  });

  it("is not hidden by a stale override row, and a fresh empty row changes nothing", () => {
    expect(resolveAppRelease({ latestVersionCode: 69, minSupportedVersionCode: 1, downloadUrl: "" })).toEqual(resolveAppRelease(null));
  });

  it("lets an admin announce a higher version, force a minimum and use another link", () => {
    // Relative to the real built-in version (not a hardcoded absolute code) so this stays a
    // genuine "admin announces something newer than the code" case across future version bumps.
    const higherCode = LATEST_APP_VERSION_CODE + 100;
    const info = resolveAppRelease({ latestVersionCode: higherCode, minSupportedVersionCode: LATEST_APP_VERSION_CODE, downloadUrl: " https://example.org/app.apk " });
    expect(info).toEqual({
      latestVersionName: versionNameFromCode(higherCode),
      latestVersionCode: higherCode,
      minSupportedVersionCode: LATEST_APP_VERSION_CODE,
      downloadUrl: "https://example.org/app.apk",
    });
  });

  it("never lets the minimum exceed the newest version", () => {
    const info = resolveAppRelease({ latestVersionCode: 1, minSupportedVersionCode: 99999, downloadUrl: "" });
    expect(info.minSupportedVersionCode).toBe(info.latestVersionCode);
  });
});

describe("the download link and the name", () => {
  it("uses one name for the app, the file and the permanent link", () => {
    expect(APP_NAME).toBe("parvaapp");
    expect(APK_FILE_NAME).toBe("parvaapp.apk");
    expect(APK_STATIC_PATH).toBe("/parvaapp.apk");
    expect(APK_STATIC_URL).toBe("https://my.parvaapp.ir/parvaapp.apk");
    expect(APK_LATEST_RELEASE_URL.endsWith(`/releases/latest/download/${APK_FILE_NAME}`)).toBe(true);
  });

  it("keeps the human-facing display name distinct from the file-safe APP_NAME — the file name always carries the \"app\" suffix the short brand name doesn't", () => {
    expect(APP_DISPLAY_NAME).toBe("parva");
    expect(APP_DISPLAY_NAME).not.toBe(APP_NAME);
    expect(APP_TAGLINE).toBe("parva | سیستم‌عامل شخصی");
    expect(APP_TAGLINE.startsWith(APP_DISPLAY_NAME)).toBe(true);
  });

  it("is redirected by the server config to the newest release's APK (the config is plain JS with no TS import, so this ties the two together)", () => {
    const config = readFileSync(resolve(process.cwd(), "next.config.mjs"), "utf8");
    expect(config).toContain(`source: "${APK_STATIC_PATH}"`);
    expect(config).toContain(`destination: "${APK_LATEST_RELEASE_URL}"`);
    expect(config).toContain("permanent: false");
    expect(config).toContain("NEXT_PUBLIC_APP_VERSION: APP_VERSION");
  });

  it("shows the human display name the same way in the Android launcher, the Capacitor config and the PWA manifest — never the file-safe APP_NAME", () => {
    const strings = readFileSync(resolve(process.cwd(), "android/app/src/main/res/values/strings.xml"), "utf8");
    // The widget picker/launcher entry gets the full "برند | تگ‌لاین" form (what a person actually
    // browses through to find the app); the task switcher's card label stays just the short name.
    expect(strings).toContain(`<string name="app_name">${APP_TAGLINE}</string>`);
    expect(strings).toContain(`<string name="title_activity_main">${APP_DISPLAY_NAME}</string>`);
    expect(strings).toContain(`<string name="splash_title">${APP_TAGLINE}</string>`);
    expect(readFileSync(resolve(process.cwd(), "capacitor.config.ts"), "utf8")).toContain(`appName: "${APP_DISPLAY_NAME}"`);

    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "public/manifest.json"), "utf8"));
    expect(manifest.name).toBe(APP_DISPLAY_NAME);
    expect(manifest.short_name).toBe(APP_DISPLAY_NAME);
    expect(manifest.description).toBe(APP_TAGLINE);
  });
});

describe("display text", () => {
  it("writes versions in Persian digits", () => {
    expect(formatVersionLabel("1.1.0", 10100)).toBe("نسخه ۱.۱.۰ (ساخت ۱۰۱۰۰)");
    expect(formatVersionLabel("1.0", null)).toBe("نسخه ۱.۰");
    expect(formatVersionLabel(null, 69)).toBe("ساخت ۶۹");
    expect(formatVersionLabel(null, null)).toBe("");
  });

  it("words the update notice with both versions when it knows them", () => {
    expect(updateNoticeText("1.1.0", "1.0")).toBe("نسخه جدید ۱.۱.۰ آماده‌ی دانلود است (نسخه‌ی شما: ۱.۰).");
    expect(updateNoticeText(null, null)).toBe("نسخه جدید آماده‌ی دانلود است.");
  });
});
