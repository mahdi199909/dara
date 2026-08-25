// Orchestrates the whole Android static-export build: run this — not
// prepare-android-export.mjs directly — from `npm run build:android`.
//
// Sets ANDROID_EXPORT_BUILD=1 programmatically (not via shell syntax like `VAR=1 cmd`, which
// isn't portable between POSIX shells and Windows cmd.exe) and then runs the two steps that
// both gate on it: prepare-android-export.mjs (destructive — deletes API routes/middleware,
// swaps in the native layout) and Next's own build CLI (next.config.mjs flips into
// output:'export' mode when it sees the same env var).
//
// Deliberately spawns nothing through a shell (`shell: true`) and never spawns `npx` — on
// Windows, `spawnSync(..., { shell: true })` mis-quotes any path containing a space (e.g. the
// very common "C:\Program Files\nodejs\node.exe"), silently truncating it at the first space and
// failing with "'C:\Program' is not recognized..." while still somehow reporting a misleading
// exit path if you're not checking output — it happened to this exact script during development.
// Resolving Next's real CLI entry point and invoking it with the current node binary sidesteps
// the whole class of problem: no shell, no quoting, works identically on every OS.
//
// ONLY run this inside a disposable checkout — a git worktree you'll discard, or a CI runner's
// fresh clone — never your real working copy. See prepare-android-export.mjs's own guard.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

process.env.ANDROID_EXPORT_BUILD = "1";

// Run in-process rather than as a child — it's a plain synchronous script, and this avoids
// spawning `node` as a child at all for this step.
await import("./prepare-android-export.mjs");

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const result = spawnSync(process.execPath, [nextBin, "build"], { stdio: "inherit", env: process.env });
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
