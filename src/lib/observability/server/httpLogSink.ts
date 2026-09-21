// Sends log records to a central collector: one HTTP POST per batch, the body newline-delimited JSON (one record per
// line — what Vector, Fluent Bit, Logstash's http input, OpenObserve and most hosted collectors accept). It is the
// "remote sink" of the sink architecture: the logger knows only LogSink, so swapping the destination never touches
// application code. It is meant to sit behind a BatchingSink (see serverSinks.ts), which queues, bounds, retries with
// back-off and opens a circuit when the collector is down — LOGGING FAILURE MUST NOT BECOME APPLICATION FAILURE.
//
// Records are already free of personal data (see doc/logging/security.md); the token is the collector's, is only ever
// put in the Authorization header, and never appears in a log line — nor does the address, which an operator may have
// written with credentials in it (https://user:password@host/…): what this sink throws is scrubbed of both.
import type { LogRecord } from "../core/schema";
import type { LogSink } from "../core/sink";

/** Anything shaped like an address inside an error message (Node's fetch quotes the whole URL in some of its errors). */
const ADDRESS_IN_TEXT = /[a-z][a-z0-9+.-]*:\/\/[^\s"']+/gi;
/** The system error code fetch hides in `cause` (ECONNREFUSED, ENOTFOUND, a TLS failure…): what tells an operator why. */
const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,39}$/;

export interface HttpLogSinkOptions {
  url: string;
  token?: string;
  /** How long one delivery may take before it is given up (and retried later by the BatchingSink). */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

export class HttpLogSink implements LogSink {
  readonly name = "http";
  private readonly url: string;
  private readonly token: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: HttpLogSinkOptions) {
    this.url = options.url;
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  }

  write(record: LogRecord): Promise<void> {
    return this.writeBatch([record]);
  }

  /** Rejects when the collector cannot be reached, is too slow or answers with an error: the BatchingSink keeps the records and tries again. */
  async writeBatch(records: LogRecord[]): Promise<void> {
    if (records.length === 0) return;
    const lines: string[] = [];
    for (const record of records) {
      try {
        lines.push(JSON.stringify(record));
      } catch {
        // one record that will not serialise must not stop the others from being delivered
      }
    }
    if (lines.length === 0) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    (timer as { unref?: () => void }).unref?.();
    try {
      const response = await this.fetchFn(this.url, {
        method: "POST",
        headers: { "content-type": "application/x-ndjson", ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
        body: `${lines.join("\n")}\n`,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`the log collector answered ${response.status}`);
    } catch (error) {
      throw new Error(this.describeFailure(error));
    } finally {
      clearTimeout(timer);
    }
  }

  /** What went wrong — a timeout, a refusal, a status, the system's error code — without the address or the token. */
  private describeFailure(error: unknown): string {
    if (error instanceof Error && error.name === "AbortError") return `the log collector did not answer within ${this.timeoutMs} ms`;
    if (!(error instanceof Error)) return "the log collector could not be reached";
    let text = error.message.replace(ADDRESS_IN_TEXT, "[address]");
    if (this.token) text = text.split(this.token).join("[token]");
    const code = (error as { cause?: { code?: unknown } }).cause?.code;
    if (typeof code === "string" && ERROR_CODE.test(code) && !text.includes(code)) text += ` (${code})`;
    return text || "the log collector could not be reached";
  }
}
