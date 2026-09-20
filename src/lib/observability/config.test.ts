import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectRuntime, resolveLoggingConfig, type RuntimeInfo } from "./config";
import { addContextProvider, getLogger, getRootCore, resetRootCore } from "./root";
import { installMemoryLogger } from "./testing";

const production: RuntimeInfo = { isServer: true, isNative: false, isTest: false, nodeEnv: "production" };
const development: RuntimeInfo = { isServer: true, isNative: false, isTest: false, nodeEnv: "development" };
const test: RuntimeInfo = { isServer: true, isNative: false, isTest: true, nodeEnv: "test" };
const web: RuntimeInfo = { isServer: false, isNative: false, isTest: false, nodeEnv: "production" };
const android: RuntimeInfo = { isServer: false, isNative: true, isTest: false, nodeEnv: "production" };

describe("resolveLoggingConfig", () => {
  it("defaults a production server to INFO, JSON lines on stdout, stack traces on", () => {
    expect(resolveLoggingConfig({}, production)).toMatchObject({
      service: "parva-api",
      platform: "server",
      environment: "production",
      level: "INFO",
      overrides: {},
      format: "json",
      includeStack: true,
      sampling: {},
      warnings: [],
    });
  });

  it("is chattier and human-readable in development, and quiet in tests", () => {
    expect(resolveLoggingConfig({}, development)).toMatchObject({ environment: "development", level: "DEBUG", format: "pretty" });
    expect(resolveLoggingConfig({}, test)).toMatchObject({ level: "ERROR", format: "json" });
  });

  it("identifies the web and the Android WebView, and gives them console objects", () => {
    expect(resolveLoggingConfig({}, web)).toMatchObject({ service: "parva-web", platform: "web", format: "object", level: "INFO" });
    expect(resolveLoggingConfig({}, android)).toMatchObject({ service: "parva-android", platform: "android", format: "object" });
  });

  it("reads LOG_LEVEL with per-domain overrides, and lets LOG_LEVEL_OVERRIDES add to them", () => {
    const config = resolveLoggingConfig({ LOG_LEVEL: "info,SYNC=debug,FINANCE=info", LOG_LEVEL_OVERRIDES: "sync=trace,auth=warn" }, production);
    expect(config.level).toBe("INFO");
    expect(config.overrides).toEqual({ SYNC: "TRACE", FINANCE: "INFO", AUTH: "WARN" });
  });

  it("takes the base level from LOG_LEVEL_OVERRIDES when LOG_LEVEL has none", () => {
    expect(resolveLoggingConfig({ LOG_LEVEL_OVERRIDES: "warn,SYNC=debug" }, production)).toMatchObject({ level: "WARN", overrides: { SYNC: "DEBUG" } });
  });

  it("reports what it could not understand and carries on with the rest", () => {
    const config = resolveLoggingConfig({ LOG_LEVEL: "loud,SYNC=debug", LOG_LEVEL_OVERRIDES: "auth=verbose" }, production);
    expect(config.level).toBe("INFO");
    expect(config.overrides).toEqual({ SYNC: "DEBUG" });
    expect(config.warnings).toEqual(['ignored unknown log level setting "loud"', 'ignored unknown log level setting "auth=verbose"']);
  });

  it("lets LOG_FORMAT force a format, and ignores nonsense", () => {
    expect(resolveLoggingConfig({ LOG_FORMAT: "pretty" }, production).format).toBe("pretty");
    expect(resolveLoggingConfig({ LOG_FORMAT: "JSON" }, development).format).toBe("json");
    expect(resolveLoggingConfig({ LOG_FORMAT: "xml" }, production).format).toBe("json");
  });

  it("reads the sampling fraction for DEBUG/TRACE, only when it is a number between 0 and 1", () => {
    expect(resolveLoggingConfig({ LOG_SAMPLE_DEBUG: "0.25" }, production).sampling).toEqual({ debug: 0.25, trace: 0.25 });
    expect(resolveLoggingConfig({ LOG_SAMPLE_DEBUG: "0" }, production).sampling).toEqual({ debug: 0, trace: 0 });
    for (const bad of ["2", "-1", "abc", ""]) expect(resolveLoggingConfig({ LOG_SAMPLE_DEBUG: bad }, production).sampling, bad).toEqual({});
  });

  it("reads LOG_STACK_TRACES as a boolean", () => {
    for (const off of ["false", "0", "no", "OFF"]) expect(resolveLoggingConfig({ LOG_STACK_TRACES: off }, production).includeStack, off).toBe(false);
    for (const on of ["true", "1", "yes", "on"]) expect(resolveLoggingConfig({ LOG_STACK_TRACES: on }, production).includeStack, on).toBe(true);
    expect(resolveLoggingConfig({ LOG_STACK_TRACES: "maybe" }, production).includeStack).toBe(true);
  });

  it("picks the environment from APP_ENV, then from NODE_ENV", () => {
    expect(resolveLoggingConfig({ APP_ENV: "staging" }, production).environment).toBe("staging");
    expect(resolveLoggingConfig({ NEXT_PUBLIC_APP_ENV: "staging" }, web).environment).toBe("staging");
    expect(resolveLoggingConfig({ APP_ENV: "nonsense" }, production).environment).toBe("production");
    expect(resolveLoggingConfig({}, development).environment).toBe("development");
  });

  it("carries the build identity: version, commit and build number", () => {
    expect(resolveLoggingConfig({ NEXT_PUBLIC_APP_VERSION: "1.1.0", GIT_COMMIT: "6eb6614", BUILD_NUMBER: "10100" }, production)).toMatchObject({ appVersion: "1.1.0", gitCommit: "6eb6614", buildNumber: "10100" });
    expect(resolveLoggingConfig({ NEXT_PUBLIC_GIT_COMMIT: "abc", NEXT_PUBLIC_BUILD_NUMBER: "7" }, android)).toMatchObject({ gitCommit: "abc", buildNumber: "7" });
    expect(resolveLoggingConfig({ GIT_COMMIT: "server", NEXT_PUBLIC_GIT_COMMIT: "client" }, production).gitCommit).toBe("server");
    expect(resolveLoggingConfig({ GIT_COMMIT: "" }, production).gitCommit).toBeUndefined();
  });

  it("uses the public variable on the client, where server-only ones do not exist", () => {
    expect(resolveLoggingConfig({ NEXT_PUBLIC_LOG_LEVEL: "warn" }, android).level).toBe("WARN");
  });
});

describe("detectRuntime", () => {
  it("recognises the Vitest server environment", () => {
    expect(detectRuntime()).toMatchObject({ isServer: true, isNative: false, isTest: true });
  });

  it("recognises the Capacitor WebView and a plain browser", () => {
    const scope = globalThis as unknown as { window?: unknown };
    try {
      scope.window = { Capacitor: { isNativePlatform: () => true } };
      expect(detectRuntime()).toMatchObject({ isServer: false, isNative: true });
      scope.window = {};
      expect(detectRuntime()).toMatchObject({ isServer: false, isNative: false });
    } finally {
      delete scope.window;
    }
  });
});

describe("the shared root logger", () => {
  beforeEach(() => resetRootCore());
  afterEach(() => {
    resetRootCore();
    vi.restoreAllMocks();
  });

  it("stays quiet in tests except for errors, writing JSON lines through console", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = getLogger("sync", "runner");
    logger.info("SYNC_STARTED");
    expect(log).not.toHaveBeenCalled();
    logger.error("SYNC_FAILED", { errorCode: "SYNC-002" });
    expect(error).toHaveBeenCalledTimes(1);
    const line = JSON.parse(error.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: "ERROR", event: "SYNC_FAILED", module: "sync", component: "runner", error_code: "SYNC-002", service: "parva-api", platform: "server" });
  });

  it("follows the environment when rebuilt", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const previous = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "debug";
    try {
      resetRootCore();
      getLogger("sync").debug("SYNC_PULL_STARTED");
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      if (previous === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = previous;
    }
  });

  it("routes handles created earlier through a test's memory logger, and back", () => {
    const early = getLogger("sync", "runner"); // created at "import time", before the swap
    const memory = installMemoryLogger();
    early.info("SYNC_STARTED", { trigger: "boot" });
    expect(memory.sink.last()).toMatchObject({ event: "SYNC_STARTED", module: "sync", component: "runner", metadata: { trigger: "boot" } });
    memory.restore();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    early.error("SYNC_FAILED");
    expect(error).toHaveBeenCalledTimes(1);
    expect(memory.sink.events()).toEqual(["SYNC_STARTED"]);
  });

  it("applies context providers registered before or after the root exists", () => {
    addContextProvider(() => ({ requestId: "req_before" }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    getLogger("api").error("API_UNHANDLED_ERROR");
    expect(JSON.parse(error.mock.calls[0][0] as string).request_id).toBe("req_before");

    addContextProvider(() => ({ userId: "usr_after" }));
    getLogger("api").error("API_UNHANDLED_ERROR");
    expect(JSON.parse(error.mock.calls[1][0] as string)).toMatchObject({ request_id: "req_before", user_id: "usr_after" });
  });

  it("exposes the core for runtime level control", () => {
    getRootCore().levels.setOverride("SYNC", "TRACE");
    expect(getRootCore().levels.effectiveLevel({ domain: "SYNC" })).toBe("TRACE");
  });
});
