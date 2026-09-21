import { describe, expect, it } from "vitest";
import { LevelController } from "./levelControl";
import { LEVELS, LEVEL_VALUE, isLevelEnabled, parseLevel, parseLevelSpec } from "./levels";

describe("levels", () => {
  it("orders TRACE < DEBUG < INFO < WARN < ERROR < CRITICAL", () => {
    const values = LEVELS.map((level) => LEVEL_VALUE[level]);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    expect(isLevelEnabled("INFO", "INFO")).toBe(true);
    expect(isLevelEnabled("DEBUG", "INFO")).toBe(false);
    expect(isLevelEnabled("CRITICAL", "ERROR")).toBe(true);
  });

  it("parses any casing and common aliases, and rejects everything else", () => {
    expect(parseLevel("debug")).toBe("DEBUG");
    expect(parseLevel(" Warn ")).toBe("WARN");
    expect(parseLevel("warning")).toBe("WARN");
    expect(parseLevel("fatal")).toBe("CRITICAL");
    expect(parseLevel("verbose")).toBeNull();
    expect(parseLevel("")).toBeNull();
    expect(parseLevel(undefined)).toBeNull();
    expect(parseLevel(30)).toBeNull();
  });
});

describe("parseLevelSpec", () => {
  it("reads a base level with per-domain overrides", () => {
    expect(parseLevelSpec("info,SYNC=debug,finance=info")).toEqual({ base: "INFO", overrides: { SYNC: "DEBUG", FINANCE: "INFO" }, invalid: [] });
  });

  it("accepts semicolons and stray whitespace, and an overrides-only spec", () => {
    expect(parseLevelSpec(" SYNC = trace ; auth=warn ")).toEqual({ base: null, overrides: { SYNC: "TRACE", AUTH: "WARN" }, invalid: [] });
  });

  it("never lets a typo switch logging off: bad tokens are reported and the rest still apply", () => {
    const spec = parseLevelSpec("info,SYNC=loud,=debug,verbose,DB=error");
    expect(spec.base).toBe("INFO");
    expect(spec.overrides).toEqual({ DB: "ERROR" });
    expect(spec.invalid).toEqual(["SYNC=loud", "=debug", "verbose"]);
  });

  it("copes with empty and missing input", () => {
    expect(parseLevelSpec("")).toEqual({ base: null, overrides: {}, invalid: [] });
    expect(parseLevelSpec(undefined)).toEqual({ base: null, overrides: {}, invalid: [] });
    expect(parseLevelSpec(",,")).toEqual({ base: null, overrides: {}, invalid: [] });
  });
});

describe("LevelController", () => {
  it("uses the base level, and the most specific override first: component, then module, then domain", () => {
    const c = new LevelController("INFO", { SYNC: "DEBUG", "SYNC-RUNNER": "TRACE", FINANCE: "WARN" });
    expect(c.effectiveLevel({})).toBe("INFO");
    expect(c.effectiveLevel({ domain: "SYNC" })).toBe("DEBUG");
    expect(c.effectiveLevel({ module: "finance" })).toBe("WARN");
    expect(c.effectiveLevel({ domain: "SYNC", module: "sync", component: "sync-runner" })).toBe("TRACE");
    expect(c.effectiveLevel({ domain: "TASK", module: "tasks" })).toBe("INFO");
  });

  it("reports the lowest level anything could enable, so disabled calls exit on one comparison", () => {
    const c = new LevelController("WARN", { SYNC: "DEBUG" });
    expect(c.minValue).toBe(LEVEL_VALUE.DEBUG);
    c.clearOverride("sync");
    expect(c.minValue).toBe(LEVEL_VALUE.WARN);
    c.setBase("ERROR");
    expect(c.minValue).toBe(LEVEL_VALUE.ERROR);
  });

  it("changes take effect immediately and expire on their own", () => {
    let now = 1_000;
    const c = new LevelController("INFO", {}, () => now);
    c.setOverride("SYNC", "DEBUG", 60_000);
    expect(c.effectiveLevel({ domain: "SYNC" })).toBe("DEBUG");
    now += 59_999;
    expect(c.effectiveLevel({ domain: "SYNC" })).toBe("DEBUG");
    now += 2;
    expect(c.effectiveLevel({ domain: "SYNC" })).toBe("INFO");
    expect(c.snapshot().overrides).toEqual({});
    expect(c.minValue).toBe(LEVEL_VALUE.INFO);
  });

  it("a per-user override can only make that user MORE verbose, never quieter", () => {
    const c = new LevelController("INFO", { FINANCE: "DEBUG" });
    c.setUserOverride("usr_1", "TRACE");
    expect(c.hasUserOverrides()).toBe(true);
    expect(c.effectiveLevel({ userId: "usr_1", module: "tasks" })).toBe("TRACE");
    expect(c.effectiveLevel({ userId: "usr_2", module: "tasks" })).toBe("INFO");
    expect(c.effectiveLevel({ userId: "usr_1", module: "finance" })).toBe("TRACE");

    c.setUserOverride("usr_3", "ERROR"); // asking for less must not silence an operator's DEBUG
    expect(c.effectiveLevel({ userId: "usr_3", module: "finance" })).toBe("DEBUG");
    expect(c.effectiveLevel({ userId: "usr_3", module: "tasks" })).toBe("INFO");

    c.clearUserOverride("usr_1");
    expect(c.effectiveLevel({ userId: "usr_1", module: "tasks" })).toBe("INFO");
  });

  it("does not echo user ids in its snapshot", () => {
    const c = new LevelController("INFO");
    c.setUserOverride("usr_secret", "DEBUG", 1000);
    expect(JSON.stringify(c.snapshot())).not.toContain("usr_secret");
    expect(c.snapshot().userOverrideCount).toBe(1);
  });
});

describe("LevelController.entries (the owner's view)", () => {
  it("lists every rule with its expiry, user ids included — unlike snapshot(), which only counts them", () => {
    let now = 1_000;
    const c = new LevelController("INFO", { SYNC: "WARN" }, () => now);
    c.setOverride("finance", "DEBUG", 60_000);
    c.setUserOverride("usr_1", "DEBUG", 120_000);
    expect(c.entries()).toEqual({
      base: "INFO",
      overrides: [
        { key: "SYNC", level: "WARN", expiresAt: null },
        { key: "FINANCE", level: "DEBUG", expiresAt: 61_000 },
      ],
      users: [{ userId: "usr_1", level: "DEBUG", expiresAt: 121_000 }],
    });
    expect(c.snapshot().userOverrideCount).toBe(1);
    expect(JSON.stringify(c.snapshot())).not.toContain("usr_1");
  });

  it("drops what has expired before listing it", () => {
    let now = 0;
    const c = new LevelController("INFO", {}, () => now);
    c.setOverride("SYNC", "DEBUG", 1_000);
    c.setUserOverride("usr_1", "DEBUG", 1_000);
    now = 2_000;
    expect(c.entries()).toMatchObject({ overrides: [], users: [] });
  });
});
