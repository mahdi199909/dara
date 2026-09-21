// What a restart leaves in the log file: a real process starts the server's observability, logs, and exits the way
// Next.js does on SIGTERM. An asynchronous queue cannot be drained once Node's 'exit' has fired, so without the
// synchronous last write the file would be missing exactly the records one wants after a restart.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const PROBE = path.join(ROOT, "src", "testing", "fixtures", "shutdownProbe.ts");

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function runProbe(env: Record<string, string>) {
  dir = mkdtempSync(path.join(tmpdir(), "parva-shutdown-"));
  const run = spawnSync(process.execPath, [TSX, PROBE], { cwd: ROOT, encoding: "utf8", timeout: 60_000, env: { ...process.env, LOG_LEVEL: "info", NODE_ENV: "production", ...env, LOG_FILE_DIR: dir } });
  const file = path.join(dir, "current.jsonl");
  const lines = readdirSync(dir).includes("current.jsonl")
    ? readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { event: string; metadata: Record<string, unknown> })
    : [];
  return { run, lines };
}

describe("a process that exits with records still queued", () => {
  it("has written the whole story to the log file: the start, what it logged, and its own shutdown", () => {
    const { run, lines } = runProbe({});
    expect(run.status, run.stderr).toBe(0);
    expect(lines.map((line) => line.event)).toEqual(["SYSTEM_STARTED", "SYNC_STARTED", "SYSTEM_SHUTDOWN"]);
    expect(lines[1].metadata.marker).toBe("written-just-before-exit");
    expect(lines[0].metadata.logSinks).toEqual(expect.arrayContaining([expect.stringContaining("server-file")]));
    expect(lines[2].metadata).toMatchObject({ exitCode: 0 });
  });

  it("does not need a log file to exit cleanly", () => {
    const run = spawnSync(process.execPath, [TSX, PROBE], { cwd: ROOT, encoding: "utf8", timeout: 60_000, env: { ...process.env, LOG_LEVEL: "info", NODE_ENV: "production", LOG_FILE_DIR: "" } });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("SYSTEM_SHUTDOWN"); // stdout, as always, has it
  });
});
