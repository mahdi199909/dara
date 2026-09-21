// Errors nobody catches. Until now an exception thrown in a click handler, a promise rejected with no .catch and a
// screen that failed to render all vanished on a phone — there is nobody to look at the WebView's console. They are
// now written down as events (SYSTEM_UNHANDLED_ERROR, UI_RENDER_ERROR), with the stack, and nothing else about
// the screen: never what the person had typed or was looking at.
//
// A component that crashes in a loop, or a timer that rejects every second, must not fill the log or the
// phone's storage: each distinct error is written a few times a minute and the rest are counted.
import type { Logger } from "../core/logger";
import { getLogger } from "../root";

export interface ErrorTarget {
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
}

export interface GlobalErrorOptions {
  target?: ErrorTarget;
  log?: Logger;
  now?: () => number;
  /** Most records of the same error per window. Default 5. */
  perErrorLimit?: number;
  /** Most records of any error per window. Default 30. */
  totalLimit?: number;
  windowMs?: number;
}

// The browser raises this one for harmless layout timing and it means nothing is wrong.
const BENIGN = /ResizeObserver loop/i;

/** "chunk-1a2b.js" out of "https://localhost/_next/static/chunks/chunk-1a2b.js?v=3": no origin, no path, no query. */
export function sourceFileName(filename: unknown): string | undefined {
  if (typeof filename !== "string" || filename === "") return undefined;
  const withoutQuery = filename.split(/[?#]/)[0];
  const last = withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
  return last || undefined;
}

class Throttle {
  private readonly windows = new Map<string, { start: number; count: number; suppressed: number }>();
  private windowStart = 0;
  private total = 0;

  constructor(private readonly now: () => number, private readonly perErrorLimit: number, private readonly totalLimit: number, private readonly windowMs: number) {}

  /** Returns how many earlier records of this error were held back (to report now), or null when this one is itself held back. */
  admit(key: string): number | null {
    const at = this.now();
    if (at - this.windowStart >= this.windowMs) {
      this.windowStart = at;
      this.total = 0;
    }
    let entry = this.windows.get(key);
    if (!entry || at - entry.start >= this.windowMs) {
      entry = { start: at, count: 0, suppressed: entry?.suppressed ?? 0 };
      this.windows.set(key, entry);
      if (this.windows.size > 200) this.windows.delete(this.windows.keys().next().value as string);
    }
    if (entry.count >= this.perErrorLimit || this.total >= this.totalLimit) {
      entry.suppressed++;
      return null;
    }
    entry.count++;
    this.total++;
    const held = entry.suppressed;
    entry.suppressed = 0;
    return held;
  }
}

function keyOf(kind: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstFrame = error instanceof Error ? (error.stack ?? "").split("\n")[1] ?? "" : "";
  return `${kind}|${message.slice(0, 120)}|${firstFrame.trim().slice(0, 120)}`;
}

/**
 * Listens for uncaught exceptions and unhandled promise rejections on `target` (the window). Returns a function
 * that removes the listeners. Installing twice on the same target is the caller's to avoid (installClientLogging does).
 */
export function installGlobalErrorCapture(options: GlobalErrorOptions = {}): () => void {
  const target = options.target ?? (typeof window !== "undefined" ? (window as unknown as ErrorTarget) : undefined);
  if (!target) return () => undefined;
  const log = options.log ?? getLogger("system", "global-errors");
  const throttle = new Throttle(options.now ?? Date.now, options.perErrorLimit ?? 5, options.totalLimit ?? 30, options.windowMs ?? 60_000);

  const report = (kind: "window.onerror" | "unhandledrejection", error: unknown, extra: Record<string, unknown>) => {
    try {
      const held = throttle.admit(keyOf(kind, error));
      if (held === null) return;
      log.log(kind === "window.onerror" ? "CRITICAL" : "ERROR", "SYSTEM_UNHANDLED_ERROR", {
        error,
        errorCode: "SYS-001",
        layer: "local",
        kind,
        ...(held > 0 ? { suppressedSince: held } : {}),
        ...extra,
      });
    } catch {
      // reporting an error must never raise another one
    }
  };

  const onError = (event: { error?: unknown; message?: string; filename?: string; lineno?: number; colno?: number }) => {
    if (event.message && BENIGN.test(event.message)) return;
    const error = event.error ?? new Error(event.message || "Script error");
    report("window.onerror", error, { source: sourceFileName(event.filename), line: event.lineno, column: event.colno });
  };
  const onRejection = (event: { reason?: unknown }) => report("unhandledrejection", event.reason ?? new Error("Promise rejected with no reason"), {});

  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}

/**
 * A screen that failed to render (called by app/error.tsx and app/global-error.tsx). `digest` is the opaque id
 * Next.js gives a server-side render failure; the message and stack are the only other things recorded.
 */
export function reportRenderError(error: Error & { digest?: string }, boundary: "segment" | "global", log: Logger = getLogger("system", "render")): void {
  try {
    log.error("UI_RENDER_ERROR", { error, errorCode: "SYS-001", layer: "local", boundary, digest: error.digest });
  } catch {
    // never raise another error from the error screen
  }
}
