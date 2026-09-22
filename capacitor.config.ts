import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // appId deliberately left as-is: Android treats it as the app's permanent identity, so
  // changing it would orphan every existing test install (including the ones from this same
  // session) rather than updating them — see this rebrand's own discussion for why that's a
  // one-way door best pulled right before a real public launch, not casually now.
  appId: "ir.mganic.dara",
  // The DISPLAYED name (launcher, widget picker) — deliberately NOT the same string as
  // APP_NAME in src/lib/appVersion.ts, which stays "parvaapp" because it also names the
  // downloadable file (parvaapp.apk) and a URL path, both of which need to stay ASCII.
  // cap sync does not regenerate android/app/src/main/res/values/strings.xml from this after
  // the platform's initial `cap add` (verified: no such logic in the installed Capacitor CLI/
  // platform packages) — that file is hand-maintained; this field only matters if the Android
  // platform is ever re-added from scratch, and is kept here so the two don't silently drift.
  appName: "پروا",
  // Next.js's static export (see next.config.mjs's BUILD_TARGET=capacitor branch) writes here.
  webDir: "out",
};

export default config;
