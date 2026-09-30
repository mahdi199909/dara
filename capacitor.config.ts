import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // Android treats this as the app's permanent identity: a build with another id installs next to the
  // old one instead of updating it. It was ir.mganic.dara up to the first 1.7.2 and was changed once,
  // deliberately, before the app went to Google Play (where it can never change again).
  appId: "ir.parvaapp",
  // The DISPLAYED name (launcher, widget picker) — same value as APP_DISPLAY_NAME in
  // src/lib/appVersion.ts, deliberately NOT the same string as that file's APP_NAME ("parvaapp"),
  // which also names the downloadable file (parvaapp.apk) and a URL path and always carries the
  // "app" suffix the short brand name doesn't.
  // cap sync does not regenerate android/app/src/main/res/values/strings.xml from this after
  // the platform's initial `cap add` (verified: no such logic in the installed Capacitor CLI/
  // platform packages) — that file is hand-maintained; this field only matters if the Android
  // platform is ever re-added from scratch, and is kept here so the two don't silently drift.
  appName: "parva",
  // Next.js's static export (see next.config.mjs's BUILD_TARGET=capacitor branch) writes here.
  webDir: "out",
  // Never inspectable from a computer over USB (chrome://inspect): the WebView holds the person's own
  // data and their session token. (The debug build type is also not debuggable — android/app/build.gradle.)
  android: { webContentsDebuggingEnabled: false },
  // The plugin's own default for every notification that names no icon (and for the ones it re-arms after a
  // reboot or an update): the parva mark instead of Android's generic "i". Same names as
  // NOTIFICATION_SMALL_ICON / NOTIFICATION_ICON_COLOR in src/local/nativeNotifications.ts.
  plugins: { LocalNotifications: { smallIcon: "ic_stat_parva", iconColor: "#0E5F54" } },
};

export default config;
