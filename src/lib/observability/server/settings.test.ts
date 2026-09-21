import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serverSettings } from "./settings";

const NAMES = ["SLOW_API_THRESHOLD_MS", "SLOW_DB_THRESHOLD_MS", "SLOW_SYNC_THRESHOLD_MS", "SLOW_REPORT_THRESHOLD_MS", "LOG_SLOW_REQUEST_MS", "LOG_SLOW_QUERY_MS"];
const clear = () => NAMES.forEach((name) => delete process.env[name]);
beforeEach(clear);
afterEach(clear);

describe("serverSettings", () => {
  it("has a default for every threshold", () => {
    expect(serverSettings()).toEqual({ slowRequestMs: 1000, slowQueryMs: 300, slowSyncMs: 3000, slowReportMs: 2000 });
  });

  it("reads the four names the logging specification gives", () => {
    process.env.SLOW_API_THRESHOLD_MS = "800";
    process.env.SLOW_DB_THRESHOLD_MS = "120";
    process.env.SLOW_SYNC_THRESHOLD_MS = "5000";
    process.env.SLOW_REPORT_THRESHOLD_MS = "4000";
    expect(serverSettings()).toEqual({ slowRequestMs: 800, slowQueryMs: 120, slowSyncMs: 5000, slowReportMs: 4000 });
  });

  it("still honours the older names, and prefers the specification's when both are set", () => {
    process.env.LOG_SLOW_REQUEST_MS = "1500";
    process.env.LOG_SLOW_QUERY_MS = "500";
    expect(serverSettings()).toMatchObject({ slowRequestMs: 1500, slowQueryMs: 500 });
    process.env.SLOW_API_THRESHOLD_MS = "700";
    process.env.SLOW_DB_THRESHOLD_MS = "90";
    expect(serverSettings()).toMatchObject({ slowRequestMs: 700, slowQueryMs: 90 });
  });

  it("ignores a value that is not a number of milliseconds, and accepts zero (everything is slow)", () => {
    process.env.SLOW_API_THRESHOLD_MS = "fast";
    process.env.SLOW_DB_THRESHOLD_MS = "-5";
    process.env.SLOW_SYNC_THRESHOLD_MS = "";
    process.env.SLOW_REPORT_THRESHOLD_MS = "0";
    expect(serverSettings()).toEqual({ slowRequestMs: 1000, slowQueryMs: 300, slowSyncMs: 3000, slowReportMs: 0 });
  });
});
