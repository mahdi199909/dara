// Rewrites the checkout in place to be static-export-compatible for the Android/Capacitor
// build: deletes everything that needs a real server at runtime (API routes, middleware) and
// swaps in the native-safe app shell layout. next.config.mjs itself flips into `output: "export"`
// mode based on the same ANDROID_EXPORT_BUILD env var this script requires — see there.
//
// DESTRUCTIVE AND IRREVERSIBLE ON THIS CHECKOUT. Only ever run this:
//   - inside a disposable git worktree you're about to throw away after `next build`, or
//   - inside a CI runner's fresh checkout (which is disposable by nature).
// Never run it in your actual working copy — see the guard below, which refuses to run unless
// ANDROID_EXPORT_BUILD=1 is set, specifically so a stray `node scripts/prepare-android-export.mjs`
// in a normal dev session doesn't wipe out every API route.
import { existsSync, rmSync, copyFileSync } from "node:fs";
import { join } from "node:path";

if (process.env.ANDROID_EXPORT_BUILD !== "1") {
  console.error(
    "Refusing to run: this script deletes src/app/api and src/middleware.ts in place. " +
      "Set ANDROID_EXPORT_BUILD=1 only when you're in a disposable worktree or CI checkout you don't need afterward."
  );
  process.exit(1);
}

const root = process.cwd();
const apiDir = join(root, "src/app/api");
const middlewareFile = join(root, "src/middleware.ts");
const androidLayout = join(root, "src/app/(app)/layout.android.tsx");
const webLayout = join(root, "src/app/(app)/layout.tsx");

if (existsSync(apiDir)) {
  rmSync(apiDir, { recursive: true, force: true });
  console.log("Removed src/app/api (Android never calls it — see src/lib/localDispatcher.ts).");
}
if (existsSync(middlewareFile)) {
  rmSync(middlewareFile, { force: true });
  console.log("Removed src/middleware.ts.");
}
if (!existsSync(androidLayout)) {
  console.error(`Expected ${androidLayout} to exist — did it get renamed/moved?`);
  process.exit(1);
}
copyFileSync(androidLayout, webLayout);
console.log("Replaced src/app/(app)/layout.tsx with the native-safe layout.android.tsx.");
