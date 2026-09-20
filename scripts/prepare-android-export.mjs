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
import { createRequire } from "node:module";

if (process.env.ANDROID_EXPORT_BUILD !== "1") {
  console.error(
    "Refusing to run: this script deletes src/app/api and src/middleware.ts in place. " +
      "Set ANDROID_EXPORT_BUILD=1 only when you're in a disposable worktree or CI checkout you don't need afterward."
  );
  process.exit(1);
}

const root = process.cwd();
const apiDir = join(root, "src/app/api");
// The sync test rig (src/testing) drives the real API route handlers, so with src/app/api gone it
// can no longer type-check — and `next build` type-checks every .ts file under the project root,
// tests included. It's only ever useful next to the routes, so it goes with them.
const testingDir = join(root, "src/testing");
const middlewareFile = join(root, "src/middleware.ts");
// Runs the server's process-level logging (uncaught-error and shutdown listeners); nothing in a
// static export has a server process to run it in.
const instrumentationFile = join(root, "src/instrumentation.ts");
const androidLayout = join(root, "src/app/(app)/layout.android.tsx");
const webLayout = join(root, "src/app/(app)/layout.tsx");

if (existsSync(apiDir)) {
  rmSync(apiDir, { recursive: true, force: true });
  console.log("Removed src/app/api (Android never calls it — see src/lib/localDispatcher.ts).");
}
if (existsSync(testingDir)) {
  rmSync(testingDir, { recursive: true, force: true });
  console.log("Removed src/testing (test rig for the API routes that were just removed).");
}
if (existsSync(middlewareFile)) {
  rmSync(middlewareFile, { force: true });
  console.log("Removed src/middleware.ts.");
}
if (existsSync(instrumentationFile)) {
  rmSync(instrumentationFile, { force: true });
  console.log("Removed src/instrumentation.ts.");
}
if (!existsSync(androidLayout)) {
  console.error(`Expected ${androidLayout} to exist — did it get renamed/moved?`);
  process.exit(1);
}
copyFileSync(androidLayout, webLayout);
console.log("Replaced src/app/(app)/layout.tsx with the native-safe layout.android.tsx.");

// src/local/drivers/browserSqlJs.ts loads this at runtime via a plain "/sql-wasm.wasm" fetch —
// Next only serves files placed under public/ at that path, so copy it in fresh from
// node_modules on every export build rather than committing a copy that could drift from the
// installed sql.js version.
const require = createRequire(import.meta.url);
const wasmSource = require.resolve("sql.js/dist/sql-wasm.wasm");
const wasmDest = join(root, "public/sql-wasm.wasm");
copyFileSync(wasmSource, wasmDest);
console.log("Copied sql-wasm.wasm into public/ for the on-device database driver.");
