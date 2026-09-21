import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryLogger } from "../testing";
import { DEFAULT_TTL_MINUTES, MAX_TTL_MINUTES, applyLoggingChange, describeLogging, resetAdminLogging, resolveTtlMinutes } from "./adminLogging";

let memory: ReturnType<typeof installMemoryLogger>;
beforeEach(() => {
  // Before the logger exists: the level controller keeps the clock it was built with, and must keep the fake one.
  vi.useFakeTimers();
  resetAdminLogging();
  memory = installMemoryLogger({ level: "INFO", overrides: { FINANCE: "INFO", SYNC: "WARN" } });
});
afterEach(() => {
  resetAdminLogging();
  memory.restore();
  vi.useRealTimers();
});

const core = () => memory.core;
const levelOf = (event: string, userId?: string) => {
  const meta = { SYNC_PULL_STARTED: { domain: "SYNC", module: "sync" }, TASK_CREATE_STARTED: { domain: "TASK", module: "tasks" }, TRANSACTION_CREATE_STARTED: { domain: "TRANSACTION", module: "finance" } }[event as "SYNC_PULL_STARTED"];
  return core().levels.effectiveLevel({ domain: meta.domain, module: meta.module, userId });
};

describe("how long a change lasts", () => {
  it("makes a verbose level expire — 30 minutes unless another time is asked, 24 hours at most", () => {
    expect(DEFAULT_TTL_MINUTES).toBe(30);
    expect(resolveTtlMinutes("DEBUG", undefined)).toBe(30);
    expect(resolveTtlMinutes("TRACE", undefined)).toBe(30);
    expect(resolveTtlMinutes("DEBUG", 5)).toBe(5);
    expect(resolveTtlMinutes("DEBUG", 100_000)).toBe(MAX_TTL_MINUTES);
    expect(resolveTtlMinutes("DEBUG", 0)).toBe(30);
    expect(resolveTtlMinutes("DEBUG", Number.NaN)).toBe(30);
  });

  it("lets a quieter level last until it is cleared, unless a time was asked for", () => {
    expect(resolveTtlMinutes("INFO", undefined)).toBeNull();
    expect(resolveTtlMinutes("WARN", undefined)).toBeNull();
    expect(resolveTtlMinutes("ERROR", 10)).toBe(10);
  });
});

describe("describeLogging", () => {
  it("reports the base level, what the environment configured, and which rules came from it", () => {
    expect(describeLogging(core())).toEqual({
      base: "INFO",
      configuredBase: "INFO",
      baseExpiresAt: null,
      overrides: [
        { scope: "FINANCE", level: "INFO", expiresAt: null, configured: true },
        { scope: "SYNC", level: "WARN", expiresAt: null, configured: true },
      ],
      users: [],
    });
  });
});

describe("turning a component up", () => {
  it("makes that component verbose for a while and leaves the others alone", () => {
    expect(levelOf("SYNC_PULL_STARTED")).toBe("WARN");
    const { before, after, summary } = applyLoggingChange({ kind: "scope", key: "sync", level: "DEBUG" }, core());
    expect(levelOf("SYNC_PULL_STARTED")).toBe("DEBUG");
    expect(levelOf("TASK_CREATE_STARTED")).toBe("INFO");
    expect(levelOf("TRANSACTION_CREATE_STARTED")).toBe("INFO");
    expect(summary).toEqual({ kind: "scope", scope: "SYNC", level: "DEBUG", ttlMinutes: 30 });
    expect(before.overrides.find((rule) => rule.scope === "SYNC")).toMatchObject({ level: "WARN", configured: true });
    const changed = after.overrides.find((rule) => rule.scope === "SYNC")!;
    expect(changed).toMatchObject({ level: "DEBUG", configured: false });
    expect(Date.parse(changed.expiresAt!) - Date.now()).toBeGreaterThan(29 * 60_000);
  });

  it("stops applying by itself when the time is up", () => {
    applyLoggingChange({ kind: "scope", key: "SYNC", level: "DEBUG", ttlMinutes: 10 }, core());
    expect(levelOf("SYNC_PULL_STARTED")).toBe("DEBUG");
    vi.advanceTimersByTime(9 * 60_000);
    expect(levelOf("SYNC_PULL_STARTED")).toBe("DEBUG");
    vi.advanceTimersByTime(2 * 60_000);
    expect(levelOf("SYNC_PULL_STARTED")).toBe("INFO"); // the temporary rule is gone; SYNC has no rule and takes the base
    expect(describeLogging(core()).overrides.some((rule) => rule.scope === "SYNC" && rule.level === "DEBUG")).toBe(false);
  });

  it("writes LOG_LEVEL_CHANGED, at the new level, with the scope and how long it lasts", () => {
    applyLoggingChange({ kind: "scope", key: "sync", level: "DEBUG", ttlMinutes: 15 }, core());
    expect(memory.sink.find("LOG_LEVEL_CHANGED")[0]).toMatchObject({ level: "INFO", metadata: { scope: "SYNC", level: "DEBUG", ttlMinutes: 15, action: "scope", source: "admin" } });
  });

  it("quiets a chatty component for good when asked to, with no expiry", () => {
    applyLoggingChange({ kind: "scope", key: "TASK", level: "ERROR" }, core());
    const rule = describeLogging(core()).overrides.find((r) => r.scope === "TASK")!;
    expect(rule).toMatchObject({ level: "ERROR", expiresAt: null, configured: false });
    expect(levelOf("TASK_CREATE_STARTED")).toBe("ERROR");
  });
});

describe("the whole system", () => {
  it("can be turned up for a limited time, and goes back to the configured level by itself", () => {
    const { after } = applyLoggingChange({ kind: "base", level: "DEBUG" }, core());
    expect(core().levels.baseLevel).toBe("DEBUG");
    expect(after.baseExpiresAt).not.toBeNull();
    vi.advanceTimersByTime(31 * 60_000);
    expect(core().levels.baseLevel).toBe("INFO");
    expect(describeLogging(core()).baseExpiresAt).toBeNull();
    expect(memory.sink.find("LOG_LEVEL_CHANGED").at(-1)).toMatchObject({ metadata: { scope: "base", level: "INFO", reason: "expired" } });
  });

  it("does not schedule a revert when the base is set to what is configured anyway, and cancels a pending one when changed again", () => {
    applyLoggingChange({ kind: "base", level: "INFO" }, core());
    expect(describeLogging(core()).baseExpiresAt).toBeNull();
    applyLoggingChange({ kind: "base", level: "DEBUG", ttlMinutes: 5 }, core());
    applyLoggingChange({ kind: "base", level: "WARN" }, core()); // a new decision replaces the temporary one
    vi.advanceTimersByTime(60 * 60_000);
    expect(core().levels.baseLevel).toBe("WARN");
  });
});

describe("tracing one person", () => {
  it("makes that person's records verbose without touching anyone else's, and lists the rule", () => {
    applyLoggingChange({ kind: "user", userId: "usr_1", level: "DEBUG" }, core());
    expect(levelOf("TASK_CREATE_STARTED", "usr_1")).toBe("DEBUG");
    expect(levelOf("TASK_CREATE_STARTED", "usr_2")).toBe("INFO");
    expect(describeLogging(core()).users).toMatchObject([{ userId: "usr_1", level: "DEBUG" }]);
    expect(memory.sink.find("LOG_LEVEL_CHANGED")[0].metadata).toMatchObject({ scope: "user", action: "user" });
    expect(JSON.stringify(memory.sink.find("LOG_LEVEL_CHANGED")[0])).not.toContain("usr_1"); // the record names no one
  });

  it("stops when cleared", () => {
    applyLoggingChange({ kind: "user", userId: "usr_1", level: "DEBUG" }, core());
    applyLoggingChange({ kind: "clear-user", userId: "usr_1" }, core());
    expect(levelOf("TASK_CREATE_STARTED", "usr_1")).toBe("INFO");
    expect(describeLogging(core()).users).toEqual([]);
  });
});

describe("putting things back", () => {
  it("returns a configured rule to its configured level, and removes one that was added", () => {
    applyLoggingChange({ kind: "scope", key: "SYNC", level: "DEBUG" }, core());
    applyLoggingChange({ kind: "scope", key: "TASK", level: "ERROR" }, core());
    const cleared = applyLoggingChange({ kind: "clear-scope", key: "sync" }, core());
    expect(cleared.summary).toMatchObject({ kind: "clear-scope", scope: "SYNC", level: "WARN" });
    expect(levelOf("SYNC_PULL_STARTED")).toBe("WARN");
    applyLoggingChange({ kind: "clear-scope", key: "TASK" }, core());
    expect(describeLogging(core()).overrides.map((rule) => rule.scope)).toEqual(["FINANCE", "SYNC"]);
  });

  it("resets everything to what the environment configured in one step, pending revert included", () => {
    applyLoggingChange({ kind: "base", level: "TRACE" }, core());
    applyLoggingChange({ kind: "scope", key: "SYNC", level: "DEBUG" }, core());
    applyLoggingChange({ kind: "scope", key: "TASK", level: "ERROR" }, core());
    applyLoggingChange({ kind: "user", userId: "usr_1", level: "DEBUG" }, core());
    const { after } = applyLoggingChange({ kind: "reset" }, core());
    expect(after).toEqual(describeLogging(core()));
    expect(after).toMatchObject({ base: "INFO", baseExpiresAt: null, users: [], overrides: [{ scope: "FINANCE", level: "INFO", configured: true }, { scope: "SYNC", level: "WARN", configured: true }] });
    vi.advanceTimersByTime(60 * 60_000);
    expect(core().levels.baseLevel).toBe("INFO");
  });

  it("gives back what the change replaced, so an audit entry can show the difference", () => {
    const { before, after } = applyLoggingChange({ kind: "scope", key: "FINANCE", level: "DEBUG", ttlMinutes: 5 }, core());
    expect(before.overrides.find((rule) => rule.scope === "FINANCE")!.level).toBe("INFO");
    expect(after.overrides.find((rule) => rule.scope === "FINANCE")!.level).toBe("DEBUG");
  });
});
