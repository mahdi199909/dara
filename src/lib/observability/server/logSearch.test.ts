import { describe, expect, it } from "vitest";
import type { LogRecord } from "../core/schema";
import { buildLogMatcher, levelFilter, parseTimeInput, toTimelineEntry } from "./logSearch";

const T0 = Date.UTC(2026, 8, 21, 10, 0, 0);
function record(over: Partial<LogRecord> = {}): LogRecord {
  return {
    timestamp: new Date(T0).toISOString(),
    level: "INFO",
    event: "TASK_CREATE_SUCCESS",
    message: "Task created.",
    service: "parva-api",
    environment: "production",
    platform: "server",
    module: "tasks",
    metadata: {},
    ...over,
  };
}
const matches = (filters: Parameters<typeof buildLogMatcher>[0], r: LogRecord) => buildLogMatcher(filters)(r);

describe("buildLogMatcher", () => {
  it("passes everything when there are no filters", () => {
    expect(matches({}, record())).toBe(true);
  });

  it("finds a person's records by their id, and a failed sign-in by the pseudonym of the address", () => {
    const own = record({ user_id: "usr_1" });
    const other = record({ user_id: "usr_2" });
    const failedLogin = record({ event: "AUTH_LOGIN_FAILED", metadata: { emailHash: "em_abc123def456" } });
    expect(matches({ userId: "usr_1" }, own)).toBe(true);
    expect(matches({ userId: "usr_1" }, other)).toBe(false);
    expect(matches({ userId: "usr_1", emailHash: "em_abc123def456" }, failedLogin)).toBe(true);
    expect(matches({ emailHash: "em_abc123def456" }, other)).toBe(false);
    expect(matches({ userId: "usr_1" }, failedLogin)).toBe(false);
  });

  it("filters by request, trace, sync and entity ids, exactly", () => {
    const r = record({ request_id: "req_1", trace_id: "t".repeat(32), sync_id: "sync_1", entity_id: "task_1" });
    expect(matches({ requestId: "req_1", syncId: "sync_1", entityId: "task_1", traceId: "t".repeat(32) }, r)).toBe(true);
    expect(matches({ requestId: "req_2" }, r)).toBe(false);
    expect(matches({ syncId: "sync_2" }, r)).toBe(false);
    expect(matches({ entityId: "task_2" }, r)).toBe(false);
    expect(matches({ traceId: "x" }, r)).toBe(false);
  });

  it("filters by level (that level and above)", () => {
    expect(matches({ minLevel: "WARN" }, record({ level: "INFO" }))).toBe(false);
    expect(matches({ minLevel: "WARN" }, record({ level: "WARN" }))).toBe(true);
    expect(matches({ minLevel: "WARN" }, record({ level: "CRITICAL" }))).toBe(true);
  });

  it("filters by event: exact names, comma-separated lists and trailing-star prefixes, in any case", () => {
    const sync = record({ event: "SYNC_PUSH_FAILED" });
    expect(matches({ event: "sync_push_failed" }, sync)).toBe(true);
    expect(matches({ event: "SYNC_*" }, sync)).toBe(true);
    expect(matches({ event: "AUTH_*,SYNC_PUSH_FAILED" }, sync)).toBe(true);
    expect(matches({ event: "AUTH_*, TASK_*" }, sync)).toBe(false);
    expect(matches({ event: "SYNC_PUSH" }, sync)).toBe(false); // a name is not a prefix without the star
  });

  it("filters by module, platform, version and error code, ignoring case", () => {
    const r = record({ module: "sync", platform: "android", app_version: "1.1.0", error_code: "SYNC-002" });
    expect(matches({ module: "SYNC", platform: "Android", version: "1.1.0", errorCode: "sync-002" }, r)).toBe(true);
    expect(matches({ platform: "web" }, r)).toBe(false);
    expect(matches({ version: "1.0.9" }, r)).toBe(false);
    expect(matches({ errorCode: "SYNC-003" }, r)).toBe(false);
    expect(matches({ errorCode: "SYNC-002" }, record({ error_code: null }))).toBe(false);
  });

  it("filters by time, inclusive at both ends", () => {
    const r = record();
    expect(matches({ sinceMs: T0, untilMs: T0 }, r)).toBe(true);
    expect(matches({ sinceMs: T0 + 1 }, r)).toBe(false);
    expect(matches({ untilMs: T0 - 1 }, r)).toBe(false);
  });

  it("needs every filter at once", () => {
    const r = record({ user_id: "usr_1", event: "SYNC_FAILED", level: "ERROR" });
    expect(matches({ userId: "usr_1", event: "SYNC_*", minLevel: "ERROR" }, r)).toBe(true);
    expect(matches({ userId: "usr_1", event: "SYNC_*", minLevel: "CRITICAL" }, r)).toBe(false);
  });
});

describe("parseTimeInput", () => {
  const now = Date.UTC(2026, 8, 21, 12, 0, 0);
  it("reads a time as long before now, or as an ISO time", () => {
    expect(parseTimeInput("15m", now)).toBe(now - 15 * 60_000);
    expect(parseTimeInput("2h", now)).toBe(now - 2 * 3_600_000);
    expect(parseTimeInput("3D", now)).toBe(now - 3 * 86_400_000);
    expect(parseTimeInput("2026-09-21T10:00:00Z", now)).toBe(Date.UTC(2026, 8, 21, 10, 0, 0));
  });

  it("gives undefined for nothing, and for what it cannot read", () => {
    for (const bad of [null, undefined, "", "  ", "yesterday", "5x", "-3h", "99999h"]) expect(parseTimeInput(bad, now), String(bad)).toBeUndefined();
  });
});

describe("levelFilter", () => {
  it("accepts a level in any case, and nothing else", () => {
    expect(levelFilter("warn")).toBe("WARN");
    expect(levelFilter("Fatal")).toBe("CRITICAL");
    expect(levelFilter("loud")).toBeUndefined();
    expect(levelFilter(null)).toBeUndefined();
  });
});

describe("toTimelineEntry", () => {
  it("keeps what identifies and explains a record, and leaves out what is absent", () => {
    const entry = toTimelineEntry(
      record({ user_id: "usr_1", request_id: "req_1", method: "POST", path: "/api/tasks", status_code: 201, duration_ms: 12.5, device_id: "dev_1", app_version: "1.1.0", entity_type: "Task", entity_id: "task_1", layer: "server", metadata: { dbQueries: 2 } })
    );
    expect(entry).toEqual({
      timestamp: new Date(T0).toISOString(),
      level: "INFO",
      event: "TASK_CREATE_SUCCESS",
      message: "Task created.",
      module: "tasks",
      platform: "server",
      layer: "server",
      requestId: "req_1",
      userId: "usr_1",
      deviceId: "dev_1",
      appVersion: "1.1.0",
      method: "POST",
      path: "/api/tasks",
      statusCode: 201,
      durationMs: 12.5,
      entityType: "Task",
      entityId: "task_1",
      metadata: { dbQueries: 2 },
    });
  });

  it("shows an error without its stack, unless the stack is asked for", () => {
    const failing = record({ level: "ERROR", event: "SYNC_FAILED", error_code: "SYNC-002", error: { type: "TypeError", message: "boom", code: "E1", status: 500, stack: "TypeError: boom\n    at f (/app/x.js:1:1)" } });
    expect(toTimelineEntry(failing).error).toEqual({ type: "TypeError", message: "boom", code: "E1", status: 500 });
    expect(toTimelineEntry(failing, { stack: true }).error?.stack).toContain("at f");
    expect(toTimelineEntry(failing).errorCode).toBe("SYNC-002");
  });

  it("redacts the metadata once more on the way out, so a record written under looser rules is still safe", () => {
    const old = record({ metadata: { password: "hunter2", token: "jwt.abc.def", amount: 4_500_000, title: "خرید هدیه برای سارا", count: 3 } });
    const shown = JSON.stringify(toTimelineEntry(old));
    for (const secret of ["hunter2", "jwt.abc.def", "4500000", "هدیه"]) expect(shown).not.toContain(secret);
    expect(toTimelineEntry(old).metadata.count).toBe(3);
  });
});
