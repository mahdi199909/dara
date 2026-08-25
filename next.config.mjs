/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  // The Android build runs scripts/prepare-android-export.mjs first (which requires this same
  // env var), so this only ever activates alongside that script — never in the normal web build
  // Railway runs, which never sets ANDROID_EXPORT_BUILD.
  ...(process.env.ANDROID_EXPORT_BUILD === "1" ? { output: "export", images: { unoptimized: true } } : {}),
};

export default nextConfig;
