// Orchestrates the whole Android static-export build: run this — not
// prepare-android-export.mjs directly — from `npm run build:android`.
//
// Sets ANDROID_EXPORT_BUILD=1 programmatically (not via shell syntax like `VAR=1 cmd`, which
// isn't portable between POSIX shells and Windows cmd.exe — this runs identically on a
// contributor's machine and on GitHub Actions' Linux runners) and then runs the two steps that
// both gate on it: prepare-android-export.mjs (destructive — deletes API routes/middleware,
// swaps in the native layout) and `next build` (next.config.mjs flips into output:'export' mode
// when it sees the same env var).
//
// ONLY run this inside a disposable checkout — a git worktree you'll discard, or a CI runner's
// fresh clone — never your real working copy. See prepare-android-export.mjs's own guard.
import { spawnSync } from "node:child_process";

const env = { ...process.env, ANDROID_EXPORT_BUILD: "1" };

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(process.execPath, ["scripts/prepare-android-export.mjs"]);
run("npx", ["next", "build"]);
