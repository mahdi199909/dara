// Process-level observability for the API server, started once from src/instrumentation.ts:
//   - the log file and central collector, when configured (serverSinks.ts),
//   - SYSTEM_STARTED with the facts one wants first when reading a log after a restart,
//   - a structured CRITICAL record for an uncaught exception or unhandled rejection,
//   - SYSTEM_SHUTDOWN on the way out, and the file's queue written down before the process ends.
//
// Next.js already installs its own uncaughtException / unhandledRejection listeners (it logs and keeps
// going), so adding ours does not change whether the process survives — it only makes what happens
// visible in the same structured form as everything else.
import { getLogger, getRootCore } from "../root";
import { rememberConfiguredLevels } from "./adminLogging";
import { installRecentProblems } from "./recentProblems";
import { ensureRequestContextProvider } from "./requestContext";
import { getServerLogSinks, startServerLogSinks } from "./serverSinks";

const STARTED_KEY = Symbol.for("parva.observability.serverStarted.v1");

export function startServerObservability(): void {
  const holder = globalThis as unknown as Record<symbol, boolean | undefined>;
  if (holder[STARTED_KEY]) return; // a hot reload or a second bundle must not double the listeners
  holder[STARTED_KEY] = true;

  ensureRequestContextProvider();
  // The rotated file and the central collector, when they are configured (LOG_FILE_DIR, LOG_REMOTE_URL): before the
  // first record below, so the startup line reaches them too. Never fatal — a bad setting is reported and ignored.
  try {
    startServerLogSinks();
  } catch (error) {
    // console-ok: the sinks are what failed to start, so there is nowhere else to say so
    globalThis.console?.warn?.("[parva-log] the log file or collector could not be started; logging continues on stdout only", error instanceof Error ? error.message : error);
  }
  // What the admin health view lists as "what went wrong just now", and the levels "reset" goes back to: both need to see the
  // process from its first record and its configured levels, so they are set up here rather than on first use.
  try {
    installRecentProblems();
    rememberConfiguredLevels();
  } catch {
    // an administration aid must never stop the server from starting
  }
  const log = getLogger(null, "process");

  process.on("uncaughtException", (error) => {
    log.critical("SYSTEM_UNHANDLED_ERROR", { error, errorCode: "SYS-001", kind: "uncaughtException" });
  });
  process.on("unhandledRejection", (reason) => {
    log.critical("SYSTEM_UNHANDLED_ERROR", { error: reason, errorCode: "SYS-001", kind: "unhandledRejection" });
  });
  process.on("exit", (exitCode) => {
    log.info("SYSTEM_SHUTDOWN", { exitCode, uptimeSeconds: Math.round(process.uptime()) });
    // An asynchronous queue cannot be drained once 'exit' has fired, so the file gets what it still holds — this record
    // included — written synchronously. (Next.js turns SIGTERM into process.exit(), so a `docker stop` ends here.)
    getServerLogSinks()?.flushSync();
  });

  log.info("SYSTEM_STARTED", {
    node: process.version,
    pid: process.pid,
    nodeEnv: process.env.NODE_ENV,
    tz: process.env.TZ,
    logLevel: getRootCore().levels.baseLevel,
    logSinks: getRootCore().sinkNames(),
  });
}
