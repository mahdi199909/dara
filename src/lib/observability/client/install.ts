// Switches the phone's logging on: gives every record the device's identity, writes records to the app's own log
// file, flushes that file when the app goes to the background, and starts writing down errors nobody catches.
// Called once, first thing at native launch (FirstRunGate), before the database is even opened — so a crash during
// startup is on record too. Nothing here waits for the disk: the returned promise settles as soon as the identity is known.
import { getRootCore } from "../root";
import { Logger, type LoggerCore } from "../core/logger";
import { BatchingSink, type BatchingEvent } from "../core/sink";
import { applyClientIdentity } from "./clientContext";
import { RotatingFileSink, type RotatingFileSinkOptions } from "../core/rotatingFileSink";
import { installGlobalErrorCapture, type ErrorTarget } from "./globalErrors";
import { loadDeviceIdentity, type DeviceIdentity, type KeyValueStore } from "./identity";
import type { LogFileStore } from "../core/logFileStore";
import { createCapacitorLogFileStore } from "./capacitorLogFileStore";

/** Where the WebView tells us it is about to be hidden or closed. */
export interface LifecycleTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface ClientLoggingOptions {
  core?: LoggerCore;
  store?: LogFileStore;
  keyValue?: KeyValueStore;
  userAgent?: string;
  timeZone?: string;
  fileSink?: Partial<RotatingFileSinkOptions>;
  /** document (visibilitychange) and window (pagehide, error, unhandledrejection). Default: the real ones. */
  document?: LifecycleTarget;
  window?: LifecycleTarget & ErrorTarget;
  /** Also flush on Capacitor's own pause event (needs @capacitor/app). Default true. */
  capacitorPause?: boolean;
  /** Something about the logging itself, for a fallback channel. Default: console.warn, rate limited. */
  onInternalProblem?: (message: string, detail?: unknown) => void;
}

export interface ClientLogging {
  identity: DeviceIdentity;
  sink: RotatingFileSink;
  batching: BatchingSink;
  /** Writes everything queued so far to the file. */
  flush(): Promise<void>;
  /** Removes the sink and every listener (tests; the app never calls this). */
  dispose(): void;
}

const INSTALLED = Symbol.for("parva.clientLogging.v1");

function defaultInternalProblem(message: string, detail?: unknown): void {
  // console-ok: the log file itself is what failed, so this cannot go through the logger without going through that same file
  globalThis.console?.warn?.(`[parva-log] ${message}`, detail instanceof Error ? detail.message : detail);
}

export async function installClientLogging(options: ClientLoggingOptions = {}): Promise<ClientLogging> {
  const holder = globalThis as unknown as Record<symbol, ClientLogging | undefined>;
  const existing = holder[INSTALLED];
  if (existing) return existing;

  const core = options.core ?? getRootCore();
  const internal = options.onInternalProblem ?? defaultInternalProblem;
  const lastReported = new Map<string, number>();
  const reportOnce = (key: string, message: string, detail?: unknown) => {
    const at = Date.now();
    if (at - (lastReported.get(key) ?? 0) < 60_000) return;
    lastReported.set(key, at);
    internal(message, detail);
  };

  const identity = await loadDeviceIdentity({ store: options.keyValue, userAgent: options.userAgent, timeZone: options.timeZone });
  applyClientIdentity(identity, core);

  const sink = new RotatingFileSink({
    store: options.store ?? createCapacitorLogFileStore(),
    onProblem: (problem) => reportOnce(`file:${problem.kind}`, `log file ${problem.kind} problem${problem.file ? ` (${problem.file})` : ""}`, problem.error),
    ...options.fileSink,
  });
  const batching = new BatchingSink(sink, {
    capacity: 2_000,
    maxBatch: 100,
    flushIntervalMs: 3_000,
    urgentFlushMs: 500,
    failureThreshold: 3,
    onEvent: (event: BatchingEvent) => {
      if (event.type === "overflow") reportOnce("overflow", `log queue full: ${event.dropped} records dropped (${event.droppedProtected} of them errors)`);
      else if (event.type === "sink_failed") reportOnce("sink", "the log file could not be written; logging continues without it for now", event.error);
      else if (event.type === "circuit_open") reportOnce("circuit", "writing the log file is paused after repeated failures");
    },
  });
  core.addSink(batching);

  const cleanups: Array<() => void> = [];

  // Write the queue out when the app is hidden or closed: a backgrounded app can be killed without another chance.
  const flushNow = () => void batching.flush();
  const doc = options.document ?? (typeof document !== "undefined" ? (document as unknown as LifecycleTarget) : undefined);
  const win = options.window ?? (typeof window !== "undefined" ? (window as unknown as LifecycleTarget & ErrorTarget) : undefined);
  if (doc) {
    const onVisibility = () => {
      if ((doc as unknown as { visibilityState?: string }).visibilityState === "hidden") flushNow();
    };
    doc.addEventListener("visibilitychange", onVisibility);
    cleanups.push(() => doc.removeEventListener("visibilitychange", onVisibility));
  }
  if (win) {
    win.addEventListener("pagehide", flushNow);
    cleanups.push(() => win.removeEventListener("pagehide", flushNow));
    // (logs through the same core the sink was added to, so the two can never disagree about where a record goes)
    cleanups.push(installGlobalErrorCapture({ target: win, log: new Logger(() => core, { module: "system", component: "global-errors", context: {} }) }));
  }
  if (options.capacitorPause !== false) {
    void import("@capacitor/app")
      .then(async ({ App }) => {
        const handle = await App.addListener("pause", flushNow);
        cleanups.push(() => void handle.remove());
      })
      .catch(() => undefined); // no Capacitor (a browser, a test): the events above are enough
  }

  const handle: ClientLogging = {
    identity,
    sink,
    batching,
    flush: () => batching.flush(),
    dispose() {
      for (const cleanup of cleanups.splice(0)) cleanup();
      core.removeSink(batching.name);
      delete holder[INSTALLED];
    },
  };
  holder[INSTALLED] = handle;
  return handle;
}

/** The running client logging, or undefined before installClientLogging (and on the web). */
export function getClientLogging(): ClientLogging | undefined {
  return (globalThis as unknown as Record<symbol, ClientLogging | undefined>)[INSTALLED];
}
