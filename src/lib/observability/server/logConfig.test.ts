import { describe, expect, it } from "vitest";
import { DEFAULT_LOG_FILE_MAX_MB, DEFAULT_LOG_RETENTION_DAYS, parseRetentionDays, resolveServerLogConfig } from "./logConfig";

describe("nothing configured", () => {
  it("means no file and no collector — stdout only, as before", () => {
    expect(resolveServerLogConfig({})).toEqual({ file: null, remote: null, warnings: [] });
    expect(resolveServerLogConfig({ LOG_FILE_DIR: "   ", LOG_REMOTE_URL: "" })).toEqual({ file: null, remote: null, warnings: [] });
  });
});

describe("the log file", () => {
  it("is switched on by a folder, with the default retention and size ceiling", () => {
    const config = resolveServerLogConfig({ LOG_FILE_DIR: "/app/logs" });
    expect(config.file).toEqual({ directory: "/app/logs", retentionDays: DEFAULT_LOG_RETENTION_DAYS, maxTotalBytes: DEFAULT_LOG_FILE_MAX_MB * 1024 * 1024 });
    expect(DEFAULT_LOG_RETENTION_DAYS).toBe(14);
  });

  it.each([
    ["7", 7],
    ["14", 14],
    ["30", 30],
    ["90", 90],
    ["45.9", 45],
    [" 21 ", 21],
  ])("keeps files for %s days", (raw, days) => {
    expect(resolveServerLogConfig({ LOG_FILE_DIR: "/l", LOG_RETENTION_DAYS: raw }).file?.retentionDays).toBe(days);
  });

  it.each(["0", "off", "never", "forever", "OFF"])("%s keeps files until the size ceiling instead", (raw) => {
    expect(resolveServerLogConfig({ LOG_FILE_DIR: "/l", LOG_RETENTION_DAYS: raw }).file?.retentionDays).toBeNull();
  });

  it("replaces an unusable retention with the default and says so", () => {
    const warnings: string[] = [];
    expect(parseRetentionDays("soon", warnings)).toBe(DEFAULT_LOG_RETENTION_DAYS);
    expect(parseRetentionDays("-3", warnings)).toBe(DEFAULT_LOG_RETENTION_DAYS);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("LOG_RETENTION_DAYS");
  });

  it("takes the size ceiling in megabytes, and refuses one too small to hold a day's log", () => {
    expect(resolveServerLogConfig({ LOG_FILE_DIR: "/l", LOG_FILE_MAX_MB: "1000" }).file?.maxTotalBytes).toBe(1000 * 1024 * 1024);
    const small = resolveServerLogConfig({ LOG_FILE_DIR: "/l", LOG_FILE_MAX_MB: "5" });
    expect(small.file?.maxTotalBytes).toBe(DEFAULT_LOG_FILE_MAX_MB * 1024 * 1024);
    expect(small.warnings[0]).toContain("LOG_FILE_MAX_MB");
  });

  it("ignores retention and size when there is no folder to apply them to", () => {
    expect(resolveServerLogConfig({ LOG_RETENTION_DAYS: "30", LOG_FILE_MAX_MB: "50" }).file).toBeNull();
  });
});

describe("the central collector", () => {
  it("is switched on by an address, and only sends warnings and above unless told otherwise", () => {
    const config = resolveServerLogConfig({ LOG_REMOTE_URL: "https://logs.example.com/ingest", LOG_REMOTE_TOKEN: " s3cret " });
    expect(config.remote).toEqual({ url: "https://logs.example.com/ingest", token: "s3cret", minLevel: "WARN", timeoutMs: 5000 });
    expect(config.warnings).toEqual([]);
  });

  it("takes its own level and timeout", () => {
    const config = resolveServerLogConfig({ LOG_REMOTE_URL: "https://c.test/x", LOG_REMOTE_MIN_LEVEL: "info", LOG_REMOTE_TIMEOUT_MS: "2500" });
    expect(config.remote).toMatchObject({ minLevel: "INFO", timeoutMs: 2500 });
  });

  it("does not send anywhere when the address is not an http(s) address, and says so", () => {
    for (const bad of ["not a url", "ftp://c.test/x", "javascript:alert(1)"]) {
      const config = resolveServerLogConfig({ LOG_REMOTE_URL: bad });
      expect(config.remote, bad).toBeNull();
      expect(config.warnings.join(" ")).toContain("LOG_REMOTE_URL");
    }
  });

  it("warns about plain http to another host, but not to this machine", () => {
    expect(resolveServerLogConfig({ LOG_REMOTE_URL: "http://collector.internal:8080/x" }).warnings.join(" ")).toContain("unencrypted");
    expect(resolveServerLogConfig({ LOG_REMOTE_URL: "http://localhost:8080/x" }).warnings).toEqual([]);
    expect(resolveServerLogConfig({ LOG_REMOTE_URL: "http://127.0.0.1:8080/x" }).warnings).toEqual([]);
  });

  it("replaces a level or timeout it cannot use with the default, and says so", () => {
    const config = resolveServerLogConfig({ LOG_REMOTE_URL: "https://c.test/x", LOG_REMOTE_MIN_LEVEL: "loud", LOG_REMOTE_TIMEOUT_MS: "5" });
    expect(config.remote).toMatchObject({ minLevel: "WARN", timeoutMs: 5000 });
    expect(config.warnings).toHaveLength(2);
  });
});
