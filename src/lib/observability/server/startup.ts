// Process-level observability for the API server, started once from src/instrumentation.ts:
//   - SYSTEM_STARTED with the facts one wants first when reading a log after a restart,
//   - a structured CRITICAL record for an uncaught exception or unhandled rejection,
//   - SYSTEM_SHUTDOWN on the way out.
//
// Next.js already installs its own uncaughtException / unhandledRejection listeners (it logs and keeps
// going), so adding ours does not change whether the process survives — it only makes what happens
// visible in the same structured form as everything else.
import { getLogger, getRootCore } from "../root";
import { ensureRequestContextProvider } from "./requestContext";

const STARTED_KEY = Symbol.for("parva.observability.serverStarted.v1");

export function startServerObservability(): void {
  const holder = globalThis as unknown as Record<symbol, boolean | undefined>;
  if (holder[STARTED_KEY]) return; // a hot reload or a second bundle must not double the listeners
  holder[STARTED_KEY] = true;

  ensureRequestContextProvider();
  const log = getLogger(null, "process");

  process.on("uncaughtException", (error) => {
    log.critical("SYSTEM_UNHANDLED_ERROR", { error, errorCode: "SYS-001", kind: "uncaughtException" });
  });
  process.on("unhandledRejection", (reason) => {
    log.critical("SYSTEM_UNHANDLED_ERROR", { error: reason, errorCode: "SYS-001", kind: "unhandledRejection" });
  });
  process.on("exit", (exitCode) => {
    log.info("SYSTEM_SHUTDOWN", { exitCode, uptimeSeconds: Math.round(process.uptime()) });
  });

  log.info("SYSTEM_STARTED", {
    node: process.version,
    pid: process.pid,
    nodeEnv: process.env.NODE_ENV,
    tz: process.env.TZ,
    logLevel: getRootCore().levels.baseLevel,
  });
}
