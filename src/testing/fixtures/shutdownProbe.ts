// A tiny server process for src/testing/shutdown.e2e.test.ts: starts the server's observability exactly as
// src/instrumentation.ts does, logs one record, and exits at once — the way Next.js does when it gets SIGTERM
// (`process.exit()`). Whatever the log file holds afterwards is what survives a restart.
import { getLogger } from "../../lib/observability";
import { startServerObservability } from "../../lib/observability/server/startup";

startServerObservability();
getLogger("sync", "probe").info("SYNC_STARTED", { marker: "written-just-before-exit" });
process.exit(0);
