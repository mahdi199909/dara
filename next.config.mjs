import { readFileSync } from "node:fs";

// One number for the web bundle, the APK (scripts/app-version.ts feeds it to Gradle) and the git
// tag — package.json's version. src/lib/appVersion.ts shows it in Settings.
const { version: APP_VERSION } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// The Android build runs scripts/prepare-android-export.mjs first (which requires this same
// env var), so this only ever activates alongside that script — never in the normal web build
// the VPS runs, which never sets ANDROID_EXPORT_BUILD.
const isAndroidExport = process.env.ANDROID_EXPORT_BUILD === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: APP_VERSION,
  },
  ...(isAndroidExport
    ? { output: "export", images: { unoptimized: true } }
    : {
        // src/instrumentation.ts starts the server's process-level logging (startup, crash and
        // shutdown records). Not needed — and not present — in the static export.
        experimental: { instrumentationHook: true },
        // The permanent download link (APK_STATIC_URL in src/lib/appVersion.ts). GitHub serves
        // whichever release is newest at the "latest" address, so publishing a release — pushing a
        // vX.Y.Z tag, see .github/workflows/build-android.yml — is all it takes to change what this
        // link downloads; nothing here or on the server needs touching per release. A config
        // redirect runs before the auth middleware, so the link works for anyone, logged in or not.
        // (Not part of the static export, which has no server to redirect from.)
        async redirects() {
          return [
            {
              source: "/parvaapp.apk",
              destination: "https://github.com/mahdi199909/dara/releases/latest/download/parvaapp.apk",
              permanent: false,
            },
          ];
        },
      }),
};

export default nextConfig;
