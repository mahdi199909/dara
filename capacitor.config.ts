import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // appId deliberately left as-is: Android treats it as the app's permanent identity, so
  // changing it would orphan every existing test install (including the ones from this same
  // session) rather than updating them — see this rebrand's own discussion for why that's a
  // one-way door best pulled right before a real public launch, not casually now.
  appId: "ir.mganic.dara",
  // Same name as the download file (parvaapp.apk) and the UI copy — see APP_NAME in
  // src/lib/appVersion.ts — so nobody meets two different names for one app.
  appName: "parvaapp",
  // Next.js's static export (see next.config.mjs's BUILD_TARGET=capacitor branch) writes here.
  webDir: "out",
};

export default config;
