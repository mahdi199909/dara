import { describe, expect, it, vi } from "vitest";
import { MetricsRegistry } from "./metrics";
import { createTestLogger } from "../testing";
import { LEVEL_VALUE } from "./levels";
import { MemorySink, type LogSink } from "./sink";

describe("record shape", () => {
  it("writes the standard record: UTC timestamp, level, event, message, service, environment, platform, metadata", () => {
    const { logger, sink } = createTestLogger({ now: () => new Date("2026-09-20T12:44:23.000Z"), appVersion: "1.1.0", gitCommit: "6eb6614", buildNumber: "10100" });
    logger.info("TASK_CREATE_SUCCESS", { taskId: "t1" });
    const record = sink.last()!;
    expect(record).toMatchObject({
      timestamp: "2026-09-20T12:44:23.000Z",
      level: "INFO",
      event: "TASK_CREATE_SUCCESS",
      message: "Task create success.",
      service: "parva-test",
      module: "tasks",
      environment: "development",
      platform: "server",
      app_version: "1.1.0",
      git_commit: "6eb6614",
      build_number: "10100",
      metadata: { taskId: "t1" },
    });
    expect(Object.keys(record).slice(0, 5)).toEqual(["timestamp", "level", "event", "message", "service"]);
    expect(() => JSON.stringify(record)).not.toThrow();
  });

  it("omits what is unknown instead of writing nulls, but always has metadata", () => {
    const { logger, sink } = createTestLogger();
    logger.info("SYNC_STARTED");
    const record = sink.last()!;
    for (const key of ["user_id", "request_id", "trace_id", "entity_id", "duration_ms", "error", "error_code", "app_version"]) expect(record).not.toHaveProperty(key);
    expect(record.metadata).toEqual({});
  });

  it("maps the named fields to their snake_case places and everything else to metadata", () => {
    const { logger, sink } = createTestLogger();
    logger.info("HABIT_CHECKIN_SUCCESS", {
      entityType: "habit",
      entityId: "hab_1",
      operation: "checkin",
      syncStatus: "PENDING",
      durationMs: 12.3456,
      layer: "local",
      syncId: "sync_1",
      localEventId: "lev_1",
      extra: "value",
    });
    expect(sink.last()).toMatchObject({
      entity_type: "habit",
      entity_id: "hab_1",
      operation: "checkin",
      sync_status: "PENDING",
      duration_ms: 12.35,
      layer: "local",
      sync_id: "sync_1",
      local_event_id: "lev_1",
      metadata: { extra: "value" },
    });
  });

  it("uses an explicit message, otherwise the registry's description", () => {
    const { logger, sink } = createTestLogger();
    logger.info("SYNC_COMPLETED", { message: "Sync finished in 832 ms" });
    logger.info("SYNC_COMPLETED");
    expect(sink.records[0].message).toBe("Sync finished in 832 ms");
    expect(sink.records[1].message).toContain("sync cycle reached its end");
  });

  it("keeps working for an event that is not in the catalogue (a mistake the types would normally catch)", () => {
    const { logger, sink } = createTestLogger();
    logger.info("NOT_A_REAL_EVENT" as never, { a: 1 });
    expect(sink.last()).toMatchObject({ event: "NOT_A_REAL_EVENT", message: "Not a real event.", metadata: { a: 1 } });
    expect(sink.last()).not.toHaveProperty("module");
  });

  it("tolerates a non-object second argument", () => {
    const { logger, sink } = createTestLogger();
    logger.info("SYNC_STARTED", "just text" as never);
    expect(sink.last()?.message).toBe("just text");
  });

  it("truncates an oversized message", () => {
    const { logger, sink } = createTestLogger();
    logger.info("SYNC_STARTED", { message: "m".repeat(5000) });
    expect(sink.last()!.message.length).toBeLessThanOrEqual(501);
  });
});

describe("errors", () => {
  it("turns any thrown value into a structured error block and classifies it", () => {
    const { logger, sink } = createTestLogger();
    const prismaLike = Object.assign(new Error("Unique constraint failed on the fields: (`email`)"), { code: "P2002" });
    logger.error("API_UNHANDLED_ERROR", { error: prismaLike });
    const record = sink.last()!;
    expect(record.error).toMatchObject({ type: "Error", code: "P2002" });
    expect(record.error_code).toBe("DB-005");
  });

  it("prefers an explicit error code over the guessed one", () => {
    const { logger, sink } = createTestLogger();
    logger.error("SYNC_FAILED", { error: Object.assign(new Error("x"), { code: "P2002" }), errorCode: "SYNC-002" });
    expect(sink.last()?.error_code).toBe("SYNC-002");
  });

  it("keeps stack traces for ERROR and above only, and never when switched off", () => {
    const withStacks = createTestLogger();
    withStacks.logger.warn("SYNC_RETRY", { error: new Error("w") });
    withStacks.logger.error("SYNC_FAILED", { error: new Error("e") });
    expect(withStacks.sink.records[0].error?.stack).toBeUndefined();
    expect(withStacks.sink.records[1].error?.stack).toContain("Error: e");

    const without = createTestLogger({ includeStack: false });
    without.logger.error("SYNC_FAILED", { error: new Error("e") });
    expect(without.sink.last()?.error?.stack).toBeUndefined();
  });

  it("scrubs secrets out of the error", () => {
    const { logger, sink } = createTestLogger();
    logger.error("DB_CONNECTION_ERROR", { error: new Error("Can't reach postgresql://u:hunter2@db:5432/x") });
    expect(JSON.stringify(sink.last())).not.toContain("hunter2");
  });
});

describe("levels", () => {
  it("drops records below the base level", () => {
    const { logger, sink } = createTestLogger({ level: "WARN" });
    logger.debug("SYNC_PULL_STARTED");
    logger.info("SYNC_STARTED");
    logger.warn("SYNC_RETRY");
    logger.error("SYNC_FAILED");
    logger.critical("SYSTEM_UNHANDLED_ERROR");
    expect(sink.events()).toEqual(["SYNC_RETRY", "SYNC_FAILED", "SYSTEM_UNHANDLED_ERROR"]);
  });

  it("raises one domain, module or component without touching the rest (LOG_LEVEL=info,SYNC=debug)", () => {
    const { logger, sink } = createTestLogger({ level: "INFO", overrides: { SYNC: "DEBUG", FINANCE: "WARN", "QUIET-COMPONENT": "ERROR" } });
    logger.debug("SYNC_PULL_STARTED"); // SYNC domain → DEBUG
    logger.debug("TASK_CREATE_STARTED"); // rest stays INFO
    logger.info("EXPENSE_CREATE_SUCCESS"); // FINANCE module → WARN
    logger.warn("EXPENSE_CREATE_FAILED");
    logger.child({ component: "quiet-component" }).warn("TASK_UPDATE_FAILED");
    expect(sink.events()).toEqual(["SYNC_PULL_STARTED", "EXPENSE_CREATE_FAILED"]);
  });

  it("changes at runtime, and says so", () => {
    const { logger, sink } = createTestLogger({ level: "WARN" });
    logger.info("TASK_CREATE_SUCCESS");
    expect(sink.records).toHaveLength(0);
    logger.setLevel("INFO");
    logger.info("TASK_CREATE_SUCCESS");
    logger.setOverride("sync", "TRACE", 60_000);
    logger.trace("SYNC_PULL_STARTED");
    logger.clearOverride("sync");
    logger.trace("SYNC_PULL_STARTED");
    expect(sink.events()).toEqual(["LOG_LEVEL_CHANGED", "TASK_CREATE_SUCCESS", "LOG_LEVEL_CHANGED", "SYNC_PULL_STARTED", "LOG_LEVEL_CHANGED"]);
    expect(sink.find("LOG_LEVEL_CHANGED")[0].metadata).toMatchObject({ scope: "base", level: "INFO" });
  });

  it("can raise the level for one user only", () => {
    const { logger, core, sink } = createTestLogger({ level: "INFO", contextProviders: [() => ({ userId: currentUser })] });
    let currentUser = "usr_normal";
    core.levels.setUserOverride("usr_traced", "DEBUG");
    logger.debug("SYNC_PULL_STARTED");
    currentUser = "usr_traced";
    logger.debug("SYNC_PULL_STARTED");
    expect(sink.records.map((r) => r.user_id)).toEqual(["usr_traced"]);
  });

  it("answers isEnabled without building anything", () => {
    const { logger } = createTestLogger({ level: "INFO", overrides: { SYNC: "DEBUG" } });
    expect(logger.isEnabled("DEBUG")).toBe(false);
    expect(logger.isEnabled("INFO")).toBe(true);
    expect(logger.isEnabled("DEBUG", "SYNC_PULL_STARTED")).toBe(true);
    expect(logger.isEnabled("TRACE", "SYNC_PULL_STARTED")).toBe(false);
  });

  it("costs one comparison when nothing would accept the record — the fields are never even read", () => {
    const { logger, sink } = createTestLogger({ level: "ERROR" });
    const trap = new Proxy({}, { get: () => { throw new Error("fields were touched"); }, ownKeys: () => { throw new Error("fields were enumerated"); } });
    expect(() => logger.debug("SYNC_PULL_STARTED", trap as never)).not.toThrow();
    expect(sink.records).toHaveLength(0);
  });
});

describe("context", () => {
  it("adds the fixed context, provider context, child bindings and call fields — later ones win", () => {
    const { logger, sink } = createTestLogger({
      staticContext: { sessionId: "sess_static", deviceId: "dev_1", tz: "Asia/Tehran" },
      contextProviders: [() => ({ requestId: "req_1", userId: "usr_provider" }), () => ({ userId: "usr_second" })],
    });
    logger.child({ module: "finance", component: "expense-service", traceId: "trace_bound" }).info("EXPENSE_CREATE_SUCCESS", { spanId: "span_call", userId: "usr_call" });
    expect(sink.last()).toMatchObject({
      session_id: "sess_static",
      device_id: "dev_1",
      tz: "Asia/Tehran",
      request_id: "req_1",
      trace_id: "trace_bound",
      span_id: "span_call",
      user_id: "usr_call",
      module: "finance",
      component: "expense-service",
    });
  });

  it("lets the caller be spared from passing any of it: one call, full context", () => {
    const { logger, sink } = createTestLogger({ contextProviders: [() => ({ userId: "usr_1", requestId: "req_1", traceId: "t", sessionId: "s", platform: "android" })] });
    logger.info("EXPENSE_CREATE_SUCCESS", { expenseId: "exp_1" });
    expect(sink.last()).toMatchObject({ user_id: "usr_1", request_id: "req_1", trace_id: "t", session_id: "s", platform: "android", metadata: { expenseId: "exp_1" } });
  });

  it("keeps a null user id (an anonymous request) and skips undefined values", () => {
    const { logger, sink } = createTestLogger({ contextProviders: [() => ({ userId: null, requestId: undefined })] });
    logger.info("SYNC_STARTED");
    expect(sink.last()).toHaveProperty("user_id", null);
    expect(sink.last()).not.toHaveProperty("request_id");
  });

  it("inherits bindings through nested children", () => {
    const { logger, sink } = createTestLogger();
    const parent = logger.child({ module: "sync", syncId: "sync_1", metadata: { trigger: "resume" } });
    parent.child({ component: "pull", metadata: { table: "Task" } }).info("SYNC_PULL_SUCCESS");
    expect(sink.last()).toMatchObject({ module: "sync", component: "pull", sync_id: "sync_1", metadata: { trigger: "resume", table: "Task" } });
  });

  it("survives a context provider that throws — that provider is skipped, the record is still written", () => {
    const reportInternal = vi.fn();
    const { logger, sink } = createTestLogger({ reportInternal, contextProviders: [() => { throw new Error("provider down"); }, () => ({ requestId: "req_ok" })] });
    logger.info("SYNC_STARTED");
    logger.info("SYNC_STARTED");
    expect(sink.records).toHaveLength(2);
    expect(sink.last()?.request_id).toBe("req_ok");
    expect(reportInternal).toHaveBeenCalledTimes(1); // reported once per minute, not per record
  });

  it("picks up context added after creation", () => {
    const { logger, core, sink } = createTestLogger();
    core.setStaticContext({ deviceId: "dev_late" });
    core.addContextProvider(() => ({ requestId: "req_late" }));
    logger.info("SYNC_STARTED");
    expect(sink.last()).toMatchObject({ device_id: "dev_late", request_id: "req_late" });
  });
});

describe("metadata privacy and limits", () => {
  it("redacts secrets, money and user text even when a caller passes them by mistake", () => {
    const { logger, sink } = createTestLogger();
    logger.info("EXPENSE_CREATE_SUCCESS", { password: "hunter2", token: "abc", amount: 250000, title: "لپ‌تاپ", email: "m.gh.hut@gmail.com", note: "kept", expenseId: "exp_1" });
    const { metadata } = sink.last()!;
    expect(metadata).toEqual({
      password: "[REDACTED]",
      token: "[REDACTED]",
      amount: "[REDACTED_MONEY]",
      title: "[REDACTED_CONTENT]",
      email: "m***@g***.com",
      note: "[REDACTED_CONTENT]",
      expenseId: "exp_1",
    });
  });

  it("scrubs secrets inside the message as well", () => {
    const { logger, sink } = createTestLogger();
    logger.warn("AUTH_LOGIN_FAILED", { message: "login for m.gh.hut@gmail.com with password=hunter2 failed" });
    expect(sink.last()!.message).not.toContain("hunter2");
    expect(sink.last()!.message).not.toContain("gh.hut@");
  });

  it("merges an explicit metadata object", () => {
    const { logger, sink } = createTestLogger();
    logger.info("SYNC_COMPLETED", { metadata: { created: 4, updated: 7 }, deleted: 2 });
    expect(sink.last()!.metadata).toEqual({ created: 4, updated: 7, deleted: 2 });
  });

  it("replaces oversized metadata with a summary instead of writing megabytes", () => {
    const { logger, sink } = createTestLogger({ maxMetadataBytes: 500 });
    logger.info("SYNC_COMPLETED", { a: "x".repeat(400), b: "y".repeat(400), c: 1 });
    expect(sink.last()!.metadata).toMatchObject({ _truncated: true, _keys: ["a", "b", "c"] });
  });

  it("copes with values JSON cannot represent", () => {
    const { logger, sink } = createTestLogger();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    logger.info("SYNC_COMPLETED", { big: 10n, cyclic, sym: Symbol("s") });
    expect(() => JSON.stringify(sink.last())).not.toThrow();
    expect(sink.last()!.metadata.big).toBe("10");
  });
});

describe("sampling", () => {
  it("thins DEBUG per request but never a failure, a security event or an error", () => {
    const { logger, sink } = createTestLogger({ sampling: { debug: 0, trace: 0, highVolumeInfo: 0 } });
    logger.debug("SYNC_PULL_STARTED");
    logger.info("HTTP_REQUEST_COMPLETED");
    logger.info("TASK_CREATE_SUCCESS"); // ordinary INFO is not thinnable
    logger.warn("SYNC_PUSH_FAILED");
    logger.info("AUTH_LOGIN_SUCCESS"); // security: protected even at INFO
    logger.error("SYNC_FAILED");
    expect(sink.events()).toEqual(["TASK_CREATE_SUCCESS", "SYNC_PUSH_FAILED", "AUTH_LOGIN_SUCCESS", "SYNC_FAILED"]);
  });

  it("keeps or drops all of one request's records together", () => {
    const { logger, sink } = createTestLogger({ sampling: { debug: 0.5, trace: 0.5, highVolumeInfo: 1 } });
    for (let i = 0; i < 100; i++) {
      const scoped = logger.child({ requestId: `req_${i}` });
      scoped.debug("SYNC_PULL_STARTED");
      scoped.debug("SYNC_PUSH_STARTED");
    }
    const perRequest = new Map<string, number>();
    for (const r of sink.records) perRequest.set(r.request_id!, (perRequest.get(r.request_id!) ?? 0) + 1);
    for (const count of perRequest.values()) expect(count).toBe(2);
    expect(perRequest.size).toBeGreaterThan(20);
    expect(perRequest.size).toBeLessThan(80);
  });
});

describe("operation() and time()", () => {
  it("logs STARTED, then SUCCESS with a duration, only after the work has finished", async () => {
    let now = 1000;
    const { logger, sink } = createTestLogger({ clock: () => now });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const running = logger.operation("EXPENSE_CREATE", { expenseId: "exp_1" }, async () => {
      await gate;
      now += 83;
      return "committed";
    });
    await Promise.resolve();
    expect(sink.events()).toEqual(["EXPENSE_CREATE_STARTED"]); // success is NOT logged while the work is in flight
    release();
    await expect(running).resolves.toBe("committed");
    expect(sink.events()).toEqual(["EXPENSE_CREATE_STARTED", "EXPENSE_CREATE_SUCCESS"]);
    expect(sink.last()).toMatchObject({ level: "INFO", duration_ms: 83, metadata: { expenseId: "exp_1" } });
  });

  it("logs FAILED with the error and rethrows — never a success for work that did not complete", async () => {
    const { logger, sink } = createTestLogger();
    await expect(
      logger.operation("EXPENSE_CREATE", { expenseId: "exp_1" }, async () => {
        throw Object.assign(new Error("deadlock"), { code: "P2034" });
      })
    ).rejects.toThrow("deadlock");
    expect(sink.events()).toEqual(["EXPENSE_CREATE_STARTED", "EXPENSE_CREATE_FAILED"]);
    expect(sink.events()).not.toContain("EXPENSE_CREATE_SUCCESS");
    // P2034 is Prisma's "transaction failed because of a write conflict or deadlock": the transaction code
    expect(sink.last()).toMatchObject({ level: "ERROR", error_code: "DB-003", error: { message: "deadlock" } });
  });

  it("works with synchronous work too", async () => {
    const { logger, sink } = createTestLogger();
    await expect(logger.operation("TASK_CREATE", undefined, () => 7)).resolves.toBe(7);
    expect(sink.events()).toEqual(["TASK_CREATE_STARTED", "TASK_CREATE_SUCCESS"]);
  });

  it("times a stopwatch", () => {
    let now = 5;
    const { logger, sink } = createTestLogger({ clock: () => now });
    const timer = logger.time("REPORT_GENERATION_COMPLETED", { reportType: "monthly" });
    now = 47.126;
    expect(timer.end("INFO", { records: 12 })).toBe(42.13);
    expect(sink.last()).toMatchObject({ duration_ms: 42.13, metadata: { reportType: "monthly", records: 12 } });
  });
});

describe("failure containment", () => {
  it("never throws when a sink throws, and the other sinks still get the record", () => {
    const good = new MemorySink();
    const bad: LogSink = { name: "bad", write: () => { throw new Error("sink exploded"); } };
    const reportInternal = vi.fn();
    const { logger, core } = createTestLogger({ sinks: [bad, good], reportInternal });
    expect(() => logger.error("SYNC_FAILED", { error: new Error("x") })).not.toThrow();
    expect(good.records).toHaveLength(1);
    expect(reportInternal).toHaveBeenCalledTimes(1);
    expect(core.sinkNames()).toEqual(["bad", "memory"]);
  });

  it("swallows a sink that rejects asynchronously", async () => {
    const bad: LogSink = { name: "async-bad", write: async () => { throw new Error("remote unavailable"); } };
    const reportInternal = vi.fn();
    const { logger } = createTestLogger({ sinks: [bad], reportInternal });
    expect(() => logger.info("SYNC_STARTED")).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(reportInternal).toHaveBeenCalledTimes(1);
  });

  it("writes a reduced LOG_INTERNAL_ERROR record when building the real one fails", () => {
    const reportInternal = vi.fn();
    const { logger, sink } = createTestLogger({ reportInternal });
    const poison = { get error(): never { throw new Error("poisoned field"); } };
    expect(() => logger.error("SYNC_FAILED", poison as never)).not.toThrow();
    const record = sink.last()!;
    expect(record).toMatchObject({ event: "LOG_INTERNAL_ERROR", level: "ERROR", error_code: "LOG-001", metadata: { failed_event: "SYNC_FAILED" } });
  });

  it("does not loop when even the reduced record cannot be written", () => {
    const failing: LogSink = { name: "always-fails", write: () => { throw new Error("nope"); } };
    const { logger } = createTestLogger({ sinks: [failing], reportInternal: () => { throw new Error("even the fallback failed"); } });
    expect(() => logger.error("SYNC_FAILED", { get error(): never { throw new Error("boom"); } } as never)).not.toThrow();
  });

  it("counts what it emits, drops and fails on", () => {
    const registry = new MetricsRegistry();
    const bad: LogSink = { name: "bad", write: () => { throw new Error("x"); } };
    const { logger } = createTestLogger({ metrics: registry, sinks: [bad], sampling: { debug: 0, trace: 0, highVolumeInfo: 0 } });
    logger.info("TASK_CREATE_SUCCESS");
    logger.error("SYNC_FAILED");
    logger.debug("SYNC_PULL_STARTED");
    const snapshot = registry.snapshot();
    expect(snapshot.counters.logs_emitted_total).toEqual(expect.arrayContaining([{ labels: 'level="INFO"', value: 1 }, { labels: 'level="ERROR"', value: 1 }]));
    expect(snapshot.counters.logs_sampled_out_total[0].value).toBe(1);
    expect(snapshot.counters.log_sink_errors_total[0]).toEqual({ labels: 'sink="bad"', value: 2 });
  });

  it("counts every warning and worse by event and level, and nothing milder, for the dashboards' failure panels", () => {
    const registry = new MetricsRegistry();
    const { logger } = createTestLogger({ metrics: registry });
    logger.info("TASK_CREATE_SUCCESS");
    logger.debug("SYNC_PULL_STARTED");
    logger.warn("AUTH_LOGIN_FAILED");
    logger.warn("AUTH_LOGIN_FAILED");
    logger.error("SYNC_FAILED");
    logger.critical("SYSTEM_UNHANDLED_ERROR");
    expect(registry.snapshot().counters.log_events_total).toEqual([
      { labels: 'event="AUTH_LOGIN_FAILED",level="WARN"', value: 2 },
      { labels: 'event="SYNC_FAILED",level="ERROR"', value: 1 },
      { labels: 'event="SYSTEM_UNHANDLED_ERROR",level="CRITICAL"', value: 1 },
    ]);
  });

  it("flushes and closes every sink, tolerating one that fails", async () => {
    const order: string[] = [];
    const a: LogSink = { name: "a", write: () => {}, flush: async () => void order.push("a"), close: async () => void order.push("close-a") };
    const b: LogSink = { name: "b", write: () => {}, flush: async () => { throw new Error("flush failed"); } };
    const { logger, core } = createTestLogger({ sinks: [a, b] });
    await expect(logger.flush()).resolves.toBeUndefined();
    await expect(core.close()).resolves.toBeUndefined();
    expect(order).toContain("a");
    expect(order).toContain("close-a");
  });
});

it("orders levels numerically the way the docs say", () => {
  expect(LEVEL_VALUE.INFO).toBeGreaterThan(LEVEL_VALUE.DEBUG);
});

