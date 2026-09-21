// The wiring: what LOG_FILE_DIR and LOG_REMOTE_URL switch on, what each destination receives, and that a failing
// destination never reaches the application or the other destinations.
import { afterEach, describe, expect, it } from "vitest";
import { utf8Text } from "../core/bytes";
import { MemoryLogFileStore } from "../core/logFileStore";
import { ACTIVE_LOG_FILE } from "../core/rotatingFileSink";
import type { LogRecord } from "../core/schema";
import { createTestLogger } from "../testing";
import { getServerLogSinks, startServerLogSinks } from "./serverSinks";

const TOKEN = "s3cr3t-token-value";
const COLLECTOR = "https://collector.test/ingest";

afterEach(() => {
  getServerLogSinks()?.dispose(); // the holder is process-wide; a test that failed half way must not leak it into the next
});

function setup(env: Record<string, string | undefined>, options: { failCollector?: boolean } = {}) {
  const test = createTestLogger();
  const store = new MemoryLogFileStore();
  const problems: Array<{ message: string; detail?: unknown }> = [];
  const requests: Array<{ url: string; headers: Record<string, string>; records: LogRecord[] }> = [];
  const behaviour = { fail: options.failCollector ?? false };
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (behaviour.fail) throw new Error(`connect ECONNREFUSED at ${String(input)} with Bearer ${TOKEN}`);
    requests.push({ url: String(input), headers: init?.headers as Record<string, string>, records: String(init?.body).trimEnd().split("\n").map((line) => JSON.parse(line) as LogRecord) });
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  const sinks = startServerLogSinks({ core: test.core, env, store, fetch: fakeFetch, onInternalProblem: (message, detail) => problems.push({ message, detail }) });
  return { ...test, sinks, store, problems, requests, behaviour };
}

const linesIn = (store: MemoryLogFileStore): LogRecord[] => {
  const file = store.files.get(ACTIVE_LOG_FILE);
  return file ? utf8Text(file.data).trimEnd().split("\n").map((line) => JSON.parse(line) as LogRecord) : [];
};

describe("with nothing configured", () => {
  it("adds nothing: the logger keeps writing to stdout only", () => {
    const { sinks, core } = setup({});
    expect(sinks.file).toBeUndefined();
    expect(sinks.remote).toBeUndefined();
    expect(core.sinkNames()).toEqual(["memory"]);
    expect(sinks.stats()).toEqual({ file: undefined, remote: undefined });
  });

  it("is started once however often it is asked: a second call gets the running one", () => {
    const first = setup({ LOG_FILE_DIR: "/logs" });
    const again = startServerLogSinks({ core: first.core, env: { LOG_FILE_DIR: "/logs" }, store: new MemoryLogFileStore() });
    expect(again).toBe(first.sinks);
    expect(first.core.sinkNames().filter((name) => name.startsWith("batching"))).toHaveLength(1);
    expect(getServerLogSinks()).toBe(first.sinks);
  });

  it("takes what it added out again, and only that", () => {
    const { sinks, core } = setup({ LOG_FILE_DIR: "/logs", LOG_REMOTE_URL: COLLECTOR });
    expect(core.sinkNames()).toHaveLength(3);
    sinks.dispose();
    expect(core.sinkNames()).toEqual(["memory"]);
    expect(getServerLogSinks()).toBeUndefined();
  });
});

describe("the log file", () => {
  it("receives every record the logger emits, at every level, once flushed", async () => {
    const { logger, sinks, store } = setup({ LOG_FILE_DIR: "/logs" });
    logger.log("DEBUG", "JOB_STARTED", { job: "x" });
    logger.log("INFO", "SYSTEM_STARTED", {});
    logger.log("WARN", "API_SLOW_REQUEST", { durationMs: 1500 });
    logger.log("ERROR", "JOB_FAILED", { job: "x" });
    expect(store.files.size).toBe(0); // queued: logging did no I/O
    await sinks.flush();
    expect(linesIn(store).map((r) => r.event)).toEqual(["JOB_STARTED", "SYSTEM_STARTED", "API_SLOW_REQUEST", "JOB_FAILED"]);
  });

  it("writes a batch with one append, not a line at a time", async () => {
    const { logger, sinks, store } = setup({ LOG_FILE_DIR: "/logs" });
    for (let i = 0; i < 50; i++) logger.info("SYSTEM_STARTED", { i });
    await sinks.flush();
    expect(store.calls.filter((call) => call === "append")).toHaveLength(1);
    expect(linesIn(store)).toHaveLength(50);
  });

  it("is the file the support timeline searches", async () => {
    const { logger, sinks } = setup({ LOG_FILE_DIR: "/logs" });
    logger.info("SYSTEM_STARTED", { marker: "needle" });
    logger.info("JOB_COMPLETED", { marker: "hay" });
    await sinks.flush();
    const found = await sinks.file!.sink.search({ match: (r) => (r.metadata as { marker?: string }).marker === "needle" });
    expect(found.records.map((r) => r.event)).toEqual(["SYSTEM_STARTED"]);
  });

  it("holds records while the disk fails, never lets that reach the caller, and writes them all once it recovers", async () => {
    const { logger, sinks, store, sink, problems } = setup({ LOG_FILE_DIR: "/logs" });
    store.faults.always = { append: new Error("ENOSPC: no space left on device") };
    for (let i = 0; i < 10; i++) expect(() => logger.info("SYSTEM_STARTED", { i })).not.toThrow();
    await sinks.flush();
    expect(sink.records).toHaveLength(10); // stdout kept every one of them
    expect(linesIn(store)).toHaveLength(0);
    expect(problems.some((p) => p.message.includes("log file"))).toBe(true);
    expect(sinks.stats().file?.queue).toMatchObject({ queued: 10, failures: 1 });

    store.faults.always = {};
    await sinks.flush();
    expect(linesIn(store).map((r) => (r.metadata as { i: number }).i)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(sinks.stats().file?.queue.queued).toBe(0);
  });

  it("says a problem with the file once a minute at most, however many times it recurs", async () => {
    const { logger, sinks, store, problems } = setup({ LOG_FILE_DIR: "/logs" });
    store.faults.always = { append: new Error("EIO") };
    for (let round = 0; round < 3; round++) {
      logger.info("SYSTEM_STARTED", { round });
      await sinks.flush();
    }
    expect(problems.filter((p) => p.message.includes("could not be written"))).toHaveLength(1);
  });
});

describe("the last moments of the process", () => {
  it("writes what the queue still holds, synchronously, and says how many records that was", async () => {
    const { logger, sinks, store } = setup({ LOG_FILE_DIR: "/logs" });
    logger.info("SYSTEM_STARTED", {});
    logger.info("SYSTEM_SHUTDOWN", { exitCode: 0 });
    expect(store.files.size).toBe(0);
    expect(sinks.flushSync()).toBe(2);
    expect(linesIn(store).map((r) => r.event)).toEqual(["SYSTEM_STARTED", "SYSTEM_SHUTDOWN"]);
    expect(sinks.flushSync()).toBe(0); // nothing is written twice
    await sinks.flush();
    expect(linesIn(store)).toHaveLength(2);
  });

  it("has nothing to do without a file, and never throws when the disk is gone", () => {
    expect(setup({}).sinks.flushSync()).toBe(0);
    getServerLogSinks()?.dispose();
    const { logger, sinks, store } = setup({ LOG_FILE_DIR: "/logs" });
    store.faults.always = { appendSync: new Error("EIO") };
    logger.info("SYSTEM_SHUTDOWN", {});
    expect(sinks.flushSync()).toBe(0);
  });
});

describe("the central collector", () => {
  it("receives warnings and above by default, as newline-delimited JSON, with the token in the header", async () => {
    const { logger, sinks, requests } = setup({ LOG_REMOTE_URL: COLLECTOR, LOG_REMOTE_TOKEN: TOKEN });
    logger.info("SYSTEM_STARTED", {});
    logger.log("DEBUG", "JOB_STARTED", {});
    logger.warn("API_SLOW_REQUEST", { durationMs: 1500 });
    logger.error("JOB_FAILED", { job: "x" });
    await sinks.flush();
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(COLLECTOR);
    expect(requests[0].headers).toMatchObject({ "content-type": "application/x-ndjson", authorization: `Bearer ${TOKEN}` });
    expect(requests[0].records.map((r) => r.event)).toEqual(["API_SLOW_REQUEST", "JOB_FAILED"]);
  });

  it("sends more when told to (LOG_REMOTE_MIN_LEVEL)", async () => {
    const { logger, sinks, requests } = setup({ LOG_REMOTE_URL: COLLECTOR, LOG_REMOTE_MIN_LEVEL: "info" });
    logger.info("SYSTEM_STARTED", {});
    logger.log("DEBUG", "JOB_STARTED", {});
    await sinks.flush();
    expect(requests.flatMap((r) => r.records.map((x) => x.event))).toEqual(["SYSTEM_STARTED"]);
  });

  it("does not disturb the application, the console or the file while it is unreachable, and does not leak its token", async () => {
    const { logger, sinks, store, sink, problems, requests, behaviour } = setup({ LOG_FILE_DIR: "/logs", LOG_REMOTE_URL: COLLECTOR, LOG_REMOTE_TOKEN: TOKEN }, { failCollector: true });
    expect(() => {
      logger.error("JOB_FAILED", { job: "a" });
      logger.error("JOB_FAILED", { job: "b" });
    }).not.toThrow();
    await sinks.flush();

    expect(sink.records.filter((r) => r.event === "JOB_FAILED")).toHaveLength(2); // stdout
    expect(linesIn(store).filter((r) => r.event === "JOB_FAILED")).toHaveLength(2); // the file
    expect(sinks.stats().remote?.queue).toMatchObject({ queued: 2, failures: 1 }); // kept for when it comes back
    const said = problems.filter((p) => p.message.includes("log collector"));
    expect(said).toHaveLength(1);
    expect(JSON.stringify(problems.map((p) => [p.message, p.detail instanceof Error ? p.detail.message : p.detail]))).not.toContain(TOKEN);

    behaviour.fail = false; // it comes back
    await sinks.flush();
    expect(requests.flatMap((r) => r.records.map((x) => (x.metadata as { job: string }).job))).toEqual(["a", "b"]);
  });
});

describe("a bad setting", () => {
  it("is reported through the logger and never stops the rest from starting", () => {
    const { sinks, sink } = setup({ LOG_FILE_DIR: "/logs", LOG_RETENTION_DAYS: "soon", LOG_REMOTE_URL: "ftp://collector.test/x" });
    expect(sinks.file).toBeDefined();
    expect(sinks.config.file?.retentionDays).toBe(14);
    expect(sinks.remote).toBeUndefined();
    const said = sink.find("LOG_INTERNAL_ERROR");
    expect(said.map((r) => r.level)).toEqual(["WARN", "WARN"]);
    expect(said.map((r) => r.message).join(" ")).toContain("LOG_RETENTION_DAYS");
    expect(said.map((r) => r.message).join(" ")).toContain("LOG_REMOTE_URL");
  });
});

describe("stats(), for the admin health view", () => {
  it("describes both destinations and holds no secret", async () => {
    const { logger, sinks } = setup({ LOG_FILE_DIR: "/logs", LOG_RETENTION_DAYS: "30", LOG_REMOTE_URL: `${COLLECTOR}?key=abc`, LOG_REMOTE_TOKEN: TOKEN });
    logger.error("JOB_FAILED", {});
    await sinks.flush();
    const stats = sinks.stats();
    expect(stats.file).toMatchObject({ directory: "/logs", retentionDays: 30, files: { linesWritten: 1 }, queue: { queued: 0, written: 1, circuit: "closed" } });
    expect(stats.remote).toMatchObject({ host: "collector.test", minLevel: "WARN", queue: { written: 1, circuit: "closed" } });
    const text = JSON.stringify(stats);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("abc");
    expect(text).not.toContain("/ingest");
  });
});
