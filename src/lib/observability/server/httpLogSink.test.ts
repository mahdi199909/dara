// The remote sink against a real HTTP server on this machine: what goes over the wire, and what happens when the
// collector refuses, hangs or is not there.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LogRecord } from "../core/schema";
import { BatchingSink, type BatchingEvent } from "../core/sink";
import { HttpLogSink } from "./httpLogSink";

interface Received {
  method?: string;
  url?: string;
  headers: IncomingMessage["headers"];
  body: string;
  answered: number;
}

class Collector {
  readonly received: Received[] = [];
  /** What it answers with. */
  status = 200;
  /** Reads the request and never answers. */
  hang = false;
  url = "";
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();

  constructor() {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        this.received.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8"), answered: this.hang ? 0 : this.status });
        if (this.hang) return;
        res.statusCode = this.status;
        res.end();
      });
    });
    this.server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });
  }

  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/ingest`;
    return this;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

const rec = (n: number, extra: Partial<LogRecord> = {}): LogRecord => ({
  timestamp: new Date(Date.UTC(2026, 8, 21, 4, 0, n)).toISOString(),
  level: "WARN",
  event: "HTTP_REQUEST_SLOW",
  message: `record ${n}`,
  service: "parva-api",
  environment: "production",
  platform: "server",
  metadata: { n },
  ...extra,
});

async function until(condition: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("gave up waiting");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

let collector: Collector;
beforeEach(async () => {
  collector = await new Collector().start();
});
afterEach(async () => {
  await collector.stop();
});

describe("what goes over the wire", () => {
  it("is one POST per batch, newline-delimited JSON, one record per line", async () => {
    await new HttpLogSink({ url: collector.url }).writeBatch([rec(1), rec(2), rec(3)]);
    expect(collector.received).toHaveLength(1);
    const [request] = collector.received;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/ingest");
    expect(request.headers["content-type"]).toBe("application/x-ndjson");
    expect(request.body.endsWith("\n")).toBe(true);
    const lines = request.body.trimEnd().split("\n");
    expect(lines.map((line) => (JSON.parse(line) as LogRecord).message)).toEqual(["record 1", "record 2", "record 3"]);
  });

  it("delivers a single record too, and carries Persian text intact", async () => {
    await new HttpLogSink({ url: collector.url }).write(rec(1, { message: "پرداخت قسط ثبت شد" }));
    expect((JSON.parse(collector.received[0].body.trim()) as LogRecord).message).toBe("پرداخت قسط ثبت شد");
  });

  it("puts the token in the Authorization header, and sends none without one", async () => {
    await new HttpLogSink({ url: collector.url, token: "s3cr3t-token-value" }).writeBatch([rec(1)]);
    await new HttpLogSink({ url: collector.url }).writeBatch([rec(2)]);
    expect(collector.received[0].headers.authorization).toBe("Bearer s3cr3t-token-value");
    expect(collector.received[1].headers.authorization).toBeUndefined();
    expect(collector.received.map((r) => r.body).join("")).not.toContain("s3cr3t-token-value");
  });

  it("sends nothing for an empty batch", async () => {
    await new HttpLogSink({ url: collector.url }).writeBatch([]);
    expect(collector.received).toHaveLength(0);
  });

  it("skips a record that cannot be serialised and still delivers the others", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await new HttpLogSink({ url: collector.url }).writeBatch([rec(1), rec(2, { metadata: circular }), rec(3)]);
    const lines = collector.received[0].body.trimEnd().split("\n");
    expect(lines.map((line) => (JSON.parse(line) as LogRecord).message)).toEqual(["record 1", "record 3"]);
  });

  it("makes no request at all when nothing in the batch can be serialised", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await new HttpLogSink({ url: collector.url }).writeBatch([rec(1, { metadata: circular })]);
    expect(collector.received).toHaveLength(0);
  });
});

describe("when the collector misbehaves", () => {
  it.each([500, 503, 401, 429])("rejects when it answers %i, so the queue keeps the records", async (status) => {
    collector.status = status;
    await expect(new HttpLogSink({ url: collector.url }).writeBatch([rec(1)])).rejects.toThrow(`the log collector answered ${status}`);
  });

  it("accepts any 2xx", async () => {
    for (const status of [200, 202, 204]) {
      collector.status = status;
      await expect(new HttpLogSink({ url: collector.url }).writeBatch([rec(1)])).resolves.toBeUndefined();
    }
  });

  it("gives up on one that never answers, after the time it was given", async () => {
    collector.hang = true;
    const started = Date.now();
    await expect(new HttpLogSink({ url: collector.url, timeoutMs: 80 }).writeBatch([rec(1)])).rejects.toThrow("the log collector did not answer within 80 ms");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("rejects when nothing is listening, and the error tells why without saying where or with what key", async () => {
    const gone = await new Collector().start();
    const goneUrl = gone.url;
    await gone.stop();
    let thrown: unknown;
    try {
      await new HttpLogSink({ url: goneUrl, token: "s3cr3t-token-value" }).writeBatch([rec(1)]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toMatch(/^fetch failed( \([A-Z_]+\))?$/);
    expect(message).not.toContain("s3cr3t-token-value");
    expect(message).not.toContain("127.0.0.1");
    expect((thrown as Error).cause).toBeUndefined(); // the original error carries the request
  });

  it("does not repeat credentials written into the address, however the underlying error words it", async () => {
    const withCredentials = collector.url.replace("http://", "http://logger:hunter2@");
    let thrown: unknown;
    try {
      await new HttpLogSink({ url: withCredentials }).writeBatch([rec(1)]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String((thrown as Error).message)).not.toContain("hunter2");
    expect(String((thrown as Error).message)).not.toContain("logger:");
  });

  it("scrubs an address or the token out of whatever a custom fetch throws", async () => {
    const sink = new HttpLogSink({
      url: "https://collector.example/ingest",
      token: "s3cr3t-token-value",
      fetch: () => Promise.reject(new Error("request to https://user:pw@collector.example/ingest failed; header Bearer s3cr3t-token-value")),
    });
    const error = await sink.writeBatch([rec(1)]).then(
      () => null,
      (e: Error) => e
    );
    expect(error?.message).toBe("request to [address] failed; header Bearer [token]");
  });

  it("describes a failure that is not an Error", async () => {
    const sink = new HttpLogSink({ url: "https://collector.example/ingest", fetch: () => Promise.reject("boom") });
    await expect(sink.writeBatch([rec(1)])).rejects.toThrow("the log collector could not be reached");
  });
});

describe("behind a BatchingSink, the way the server runs it", () => {
  it("holds records while the collector is down, opens the circuit, and delivers everything in order when it is back", async () => {
    collector.status = 503;
    const events: BatchingEvent[] = [];
    const batching = new BatchingSink(new HttpLogSink({ url: collector.url, timeoutMs: 1000 }), {
      flushIntervalMs: 5,
      failureThreshold: 2,
      baseBackoffMs: 30,
      maxBackoffMs: 60,
      onEvent: (event) => events.push(event),
    });
    for (let i = 1; i <= 5; i++) batching.write(rec(i));

    await until(() => events.some((event) => event.type === "circuit_open"));
    expect(batching.stats()).toMatchObject({ written: 0, queued: 5 });

    collector.status = 200; // the collector recovers
    await until(() => batching.stats().written === 5);
    expect(events.some((event) => event.type === "circuit_closed")).toBe(true);

    const delivered = collector.received.filter((request) => request.answered === 200).flatMap((request) => request.body.trimEnd().split("\n").map((line) => (JSON.parse(line) as LogRecord).message));
    expect(delivered).toEqual(["record 1", "record 2", "record 3", "record 4", "record 5"]);
    await batching.close();
  });

  it("reports a failing collector without ever putting the token in what it reports", async () => {
    collector.status = 500;
    const events: BatchingEvent[] = [];
    const batching = new BatchingSink(new HttpLogSink({ url: collector.url, token: "s3cr3t-token-value" }), { flushIntervalMs: 5, onEvent: (event) => events.push(event) });
    batching.write(rec(1));
    await until(() => events.some((event) => event.type === "sink_failed"));
    const failure = events.find((event): event is Extract<BatchingEvent, { type: "sink_failed" }> => event.type === "sink_failed")!;
    expect((failure.error as Error).message).toBe("the log collector answered 500");
    expect(JSON.stringify(events, (_key, value) => (value instanceof Error ? value.message : value))).not.toContain("s3cr3t-token-value");
    collector.status = 200;
    await batching.close();
  });
});
