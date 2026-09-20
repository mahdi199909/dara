// Prints the Android build's version as KEY=VALUE lines, for CI to append to $GITHUB_ENV:
//
//   npx tsx scripts/app-version.ts >> "$GITHUB_ENV"
//
// package.json's version is the single source; the versionCode is derived from it
// (src/lib/appVersion.ts) instead of being CI's run number, so the number the server announces for
// a release is known before the APK exists. Fails loudly if the version isn't MAJOR.MINOR.PATCH
// or if it disagrees with the release the server announces (LATEST_APP_RELEASE) — a release
// whose tag, APK and update notice don't all say the same version must never get built.
import { readFileSync } from "node:fs";
import { LATEST_APP_RELEASE, versionCodeFromName } from "../src/lib/appVersion";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

if (version !== LATEST_APP_RELEASE.versionName) {
  console.error(
    `package.json says ${version} but src/lib/appVersion.ts announces ${LATEST_APP_RELEASE.versionName} as the latest release — bump both together.`
  );
  process.exit(1);
}

console.log(`ANDROID_VERSION_NAME=${version}`);
console.log(`ANDROID_VERSION_CODE=${versionCodeFromName(version)}`);
