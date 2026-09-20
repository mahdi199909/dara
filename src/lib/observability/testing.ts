// Helpers for tests that need to see what was logged. Not imported by application code.
import { createLoggerCore, Logger, type LoggerCore, type LoggerOptions } from "./core/logger";
import { MetricsRegistry } from "./core/metrics";
import { MemorySink } from "./core/sink";
import { setRootCoreOverride } from "./root";

export interface TestLogger {
  logger: Logger;
  core: LoggerCore;
  sink: MemorySink;
}

/** A standalone logger writing to memory at TRACE, with its own metrics so tests do not share counters. */
export function createTestLogger(overrides: Partial<LoggerOptions> = {}): TestLogger {
  const sink = new MemorySink(10_000);
  const core = createLoggerCore({
    service: "parva-test",
    platform: "server",
    environment: "development",
    level: "TRACE",
    sinks: [sink],
    metrics: new MetricsRegistry(),
    reportInternal: () => {},
    ...overrides,
  });
  return { logger: new Logger(() => core), core, sink };
}

/**
 * Routes every `getLogger()` handle in the process to a memory sink, so code under test that logs
 * through the shared logger can be asserted on. Call `restore()` in afterEach.
 */
export function installMemoryLogger(overrides: Partial<LoggerOptions> = {}): TestLogger & { restore(): void } {
  const test = createTestLogger(overrides);
  setRootCoreOverride(test.core);
  return { ...test, restore: () => setRootCoreOverride(null) };
}
