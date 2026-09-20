// Runs once when the Next.js server process starts (enabled by `experimental.instrumentationHook`
// in next.config.mjs). It starts the process-level logging: the startup record, the crash and
// unhandled-rejection records, the shutdown record. The Edge runtime (middleware) and the Android
// export never load this file — the export build deletes it (scripts/prepare-android-export.mjs).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startServerObservability } = await import("./lib/observability/server/startup");
    startServerObservability();
  }
}
