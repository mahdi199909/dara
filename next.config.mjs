import { readFileSync } from "node:fs";

// One number for the web bundle, the APK (scripts/app-version.ts feeds it to Gradle) and the git
// tag — package.json's version. src/lib/appVersion.ts shows it in Settings.
const { version: APP_VERSION } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// The Android build runs scripts/prepare-android-export.mjs first (which requires this same
// env var), so this only ever activates alongside that script — never in the normal web build
// the VPS runs, which never sets ANDROID_EXPORT_BUILD.
const isAndroidExport = process.env.ANDROID_EXPORT_BUILD === "1";

// Sent with every response of the web server (not the static export, which has no server). The
// app loads nothing from other origins, so everything is pinned to 'self'. Next's own bootstrap
// is inline <script>, hence 'unsafe-inline'; the dev server's hot reload also needs 'unsafe-eval'.
const isDev = process.env.NODE_ENV !== "production";
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  // Browsers only honour this over HTTPS, so it is harmless on http://localhost.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // my.parvaapp.ir is the app, not the site: the landing page on parvaapp.ir is what search engines
  // should show. Covers every response — pages, API, the APK — not just the HTML <meta> tag.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

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
        // src/instrumentation.ts (the server's startup, crash and shutdown records) is picked up
        // automatically since Next 15 — no flag. It is not present in the static export.
        poweredByHeader: false,
        async headers() {
          return [{ source: "/:path*", headers: SECURITY_HEADERS }];
        },
        // The permanent download link (APK_STATIC_URL in src/lib/appVersion.ts) is served by this
        // server from its own downloads folder (src/app/api/app/apk/route.ts), not by GitHub. Not part
        // of the static export, which has no server.
        async rewrites() {
          return [{ source: "/parvaapp.apk", destination: "/api/app/apk" }];
        },
        async redirects() {
          return [
            // The owner's tools moved to /dashboard (the middleware answers 404 here for anyone else first).
            { source: "/admin", destination: "/dashboard", permanent: false },
          ];
        },
      }),
};

export default nextConfig;
