import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE", Data: "DATA" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    writeFile: vi.fn(async ({ path, data }: { path: string; data: string }) => void files.set(path, data)),
    getUri: vi.fn(async ({ path }: { path: string }) => ({ uri: `file:///cache/${path}` })),
  },
}));
const share = vi.hoisted(() => ({ share: vi.fn() }));
vi.mock("@capacitor/share", () => ({ Share: share }));

import type { LogRecord } from "../core/schema";
import { createTestLogger, installMemoryLogger } from "../testing";
import { applyClientIdentity } from "./clientContext";
import { buildDiagnosticReport, cleanRecord, DIAGNOSTIC_FORMAT } from "./diagnostics";
import { getClientLogging, installClientLogging, type ClientLogging } from "./install";
import { MemoryLogFileStore } from "./logFileStore";
import { DiagnosticsUnavailableError, collectDiagnosticReport, shareDiagnosticReport } from "./shareReport";

const T0 = Date.UTC(2026, 8, 21, 4, 0, 0);

function record(n: number, extra: Partial<LogRecord> = {}): LogRecord {
  return {
    timestamp: new Date(T0 + n * 1000).toISOString(),
    level: "INFO",
    event: "SYNC_COMPLETED",
    message: `record ${n}`,
    service: "parva-android",
    environment: "production",
    platform: "android",
    metadata: { n },
    ...extra,
  };
}

const input = (records: LogRecord[], over: Partial<Parameters<typeof buildDiagnosticReport>[0]> = {}) => ({
  now: new Date(T0),
  app: { version: "1.2.0", platform: "android" },
  device: { deviceId: "dev_01J8ZQ2M3N4P5R6S7T8V9W0X1Y", osVersion: "Android 14", tz: "Asia/Tehran" },
  logging: { level: "INFO" },
  records,
  ...over,
});

describe("buildDiagnosticReport", () => {
  it("is one JSON document that says what it is, who made it and what is in it", () => {
    const report = buildDiagnosticReport(input([record(1), record(2, { level: "ERROR", event: "SYNC_FAILED" }), record(3, { level: "WARN", event: "SYNC_PARTIAL_SUCCESS" })]));
    const parsed = JSON.parse(report.json);
    expect(parsed).toMatchObject({
      format: DIAGNOSTIC_FORMAT,
      version: 1,
      createdAt: new Date(T0).toISOString(),
      app: { version: "1.2.0" },
      device: { deviceId: "dev_01J8ZQ2M3N4P5R6S7T8V9W0X1Y", osVersion: "Android 14", tz: "Asia/Tehran" },
      counts: { records: 3, byLevel: { INFO: 1, ERROR: 1, WARN: 1 }, byEvent: { SYNC_FAILED: 1, SYNC_PARTIAL_SUCCESS: 1 } },
    });
    expect(parsed.records.map((r: LogRecord) => r.message)).toEqual(["record 1", "record 2", "record 3"]);
    expect(report).toMatchObject({ recordCount: 3, omittedForSize: 0, fileName: "parva-diagnostics-20260921-040000.json" });
    expect(report.bytes).toBeGreaterThan(300);
    expect(parsed.note).toMatch(/no titles/);
  });

  it("puts one record on each line, so the file reads like the log it is", () => {
    const { json } = buildDiagnosticReport(input([record(1), record(2)]));
    const lines = json.split("\n").filter((line) => line.includes('"event":"SYNC_COMPLETED"'));
    expect(lines).toHaveLength(2);
  });

  it("cleans every record once more: an e-mail address, a token or a password that reached the log is masked", () => {
    const dirty = record(1, {
      message: "could not sync for sara@example.com",
      error: { type: "Error", message: "request failed with Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4In0.abcdefghijklmnop", stack: "Error: boom\n    at token=abc123def456 (app.js:1:1)" },
      metadata: { password: "hunter2hunter2", note: "call 09123456789", nested: { authorization: "Bearer secret-token-value" } },
    });
    const text = buildDiagnosticReport(input([dirty])).json;
    for (const secret of ["sara@example.com", "eyJhbGciOiJIUzI1NiJ9", "hunter2hunter2", "secret-token-value", "abc123def456"]) expect(text).not.toContain(secret);
    expect(cleanRecord(dirty).metadata).toMatchObject({ password: "[REDACTED]" });
  });

  it("keeps the newest records when the size limit cuts, and says how many older ones it left out", () => {
    const many = Array.from({ length: 400 }, (_, i) => record(i, { metadata: { n: i, padding: "x".repeat(200) } }));
    const report = buildDiagnosticReport(input(many, { maxBytes: 40_000 }));
    const parsed = JSON.parse(report.json);
    expect(report.bytes).toBeLessThanOrEqual(40_000);
    expect(report.omittedForSize).toBeGreaterThan(0);
    expect(report.recordCount + report.omittedForSize).toBe(400);
    const kept = parsed.records.map((r: LogRecord) => (r.metadata as { n: number }).n);
    expect(kept[kept.length - 1]).toBe(399); // the newest is there
    expect(kept).toEqual([...kept].sort((a, b) => a - b)); // oldest first
    expect(parsed.counts.records).toBe(report.recordCount);
  });

  it("copes with no records at all", () => {
    const report = buildDiagnosticReport(input([]));
    expect(JSON.parse(report.json).records).toEqual([]);
    expect(report.recordCount).toBe(0);
  });

  it("carries the last sync and the counters when it is given them, and null when it is not", () => {
    const withSync = JSON.parse(buildDiagnosticReport(input([record(1)], { sync: { ok: false, kind: "network", pushedCount: 0, pulledCount: 2 }, metrics: { counters: { logs_emitted_total: [{ labels: { level: "INFO" }, value: 5 }] }, histograms: {} } as never })).json);
    expect(withSync.sync).toMatchObject({ ok: false, kind: "network" });
    expect(withSync.metrics.counters.logs_emitted_total).toBeDefined();
    expect(JSON.parse(buildDiagnosticReport(input([])).json).sync).toBeNull();
  });
});

describe("sharing the report", () => {
  let memory: ReturnType<typeof installMemoryLogger>;
  let installed: ClientLogging | undefined;
  beforeEach(() => {
    files.clear();
    share.share.mockReset().mockResolvedValue({});
    memory = installMemoryLogger();
  });
  afterEach(() => {
    installed?.dispose();
    installed = undefined;
    memory.restore();
  });

  async function install() {
    installed = await installClientLogging({
      core: memory.core,
      store: new MemoryLogFileStore(),
      keyValue: { get: async () => null, set: async () => undefined },
      userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S918B) Chrome/126",
      timeZone: "Asia/Tehran",
      document: { addEventListener() {}, removeEventListener() {} },
      window: { addEventListener() {}, removeEventListener() {} },
      capacitorPause: false,
      onInternalProblem: () => undefined,
    });
    return installed;
  }

  it("is only available where there is a log file to read", async () => {
    expect(getClientLogging()).toBeUndefined();
    await expect(collectDiagnosticReport()).rejects.toBeInstanceOf(DiagnosticsUnavailableError);
    await expect(shareDiagnosticReport()).rejects.toThrow(/اندروید/);
    expect(memory.sink.find("EXPORT_FAILED")).toEqual([]); // "not on a phone" is not a failure worth recording
  });

  it("collects what was logged, including what was still waiting to be written, with the phone's identity", async () => {
    const handle = await install();
    memory.logger.warn("SYNC_FAILED", { errorCode: "SYNC-001", syncId: "sync_01J8ZQ2M3N4P5R6S7T8V9W0X1Y" });
    const report = await collectDiagnosticReport();
    const parsed = JSON.parse(report.json);
    expect(parsed.records.map((r: LogRecord) => r.event)).toContain("SYNC_FAILED");
    expect(parsed.device).toMatchObject({ deviceId: handle.identity.deviceId, osVersion: "Android 14", tz: "Asia/Tehran" });
    expect(parsed.logging.file).toMatchObject({ linesWritten: expect.any(Number) });
    expect(parsed.metrics).toBeTruthy();
  });

  it("writes the file to the app's cache, opens the share sheet with it, and records that it was made — counts and size only", async () => {
    await install();
    memory.logger.info("SYNC_COMPLETED", { syncId: "sync_01J8ZQ2M3N4P5R6S7T8V9W0X1Y" });
    const report = await shareDiagnosticReport();

    expect(files.get(report.fileName)).toBe(report.json);
    expect(share.share).toHaveBeenCalledWith(expect.objectContaining({ files: [`file:///cache/${report.fileName}`] }));
    const made = memory.sink.find("EXPORT_COMPLETED")[0];
    expect(made).toMatchObject({ level: "INFO", layer: "local", metadata: { kind: "diagnostic-report", recordCount: report.recordCount, fileSize: report.bytes } });
    expect(JSON.stringify(made)).not.toContain("SYNC_COMPLETED");
  });

  it("reports a failure to write the file and lets the caller show it", async () => {
    await install();
    const { Filesystem } = await import("@capacitor/filesystem");
    vi.mocked(Filesystem.writeFile).mockRejectedValueOnce(new Error("No space left on device"));
    await expect(shareDiagnosticReport()).rejects.toThrow("No space left");
    expect(memory.sink.find("EXPORT_FAILED")[0]).toMatchObject({ level: "ERROR", metadata: { kind: "diagnostic-report" } });
    expect(share.share).not.toHaveBeenCalled();
  });

  it("does not depend on the test logger or on identity to exist", () => {
    expect(createTestLogger().sink.records).toEqual([]);
    applyClientIdentity({ deviceId: "dev_01J8ZQ2M3N4P5R6S7T8V9W0X1Y" }, createTestLogger().core);
  });
});
