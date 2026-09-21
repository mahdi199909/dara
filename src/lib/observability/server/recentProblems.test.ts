import { afterEach, describe, expect, it } from "vitest";
import { createTestLogger } from "../testing";
import { installRecentProblems, recentProblems, resetRecentProblems } from "./recentProblems";

afterEach(() => resetRecentProblems());

describe("recentProblems", () => {
  it("is empty until it is installed", () => {
    expect(recentProblems()).toEqual([]);
  });

  it("keeps warnings and errors, newest first, and nothing milder", () => {
    const { logger, core } = createTestLogger();
    installRecentProblems(core);
    logger.info("TASK_CREATE_SUCCESS");
    logger.warn("AUTH_LOGIN_FAILED", { errorCode: "AUTH-001" });
    logger.debug("SYNC_PULL_STARTED");
    logger.error("SYNC_FAILED", { errorCode: "SYNC-002", error: new Error("boom") });
    expect(recentProblems().map((p) => p.event)).toEqual(["SYNC_FAILED", "AUTH_LOGIN_FAILED"]);
  });

  it("shows the facts one scans a list for, and no metadata and no stack", () => {
    const { logger, core } = createTestLogger();
    installRecentProblems(core);
    logger.error("API_UNHANDLED_ERROR", { httpMethod: "POST", httpPath: "/api/tasks", statusCode: 500, errorCode: "SYS-001", error: new TypeError("secret detail in a message"), extra: "a value that belongs in metadata" });
    const [problem] = recentProblems();
    expect(problem).toMatchObject({ level: "ERROR", event: "API_UNHANDLED_ERROR", errorCode: "SYS-001", request: "POST /api/tasks", statusCode: 500, errorType: "TypeError" });
    expect(problem.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(problem)).not.toContain("a value that belongs in metadata");
    expect(JSON.stringify(problem)).not.toContain("stack");
  });

  it("honours the limit, and holds only the latest hundred", () => {
    const { logger, core } = createTestLogger();
    installRecentProblems(core);
    for (let i = 0; i < 130; i++) logger.warn("AUTH_LOGIN_FAILED", { message: `attempt ${i}` });
    expect(recentProblems(5).map((p) => p.message)).toEqual(["attempt 129", "attempt 128", "attempt 127", "attempt 126", "attempt 125"]);
    expect(recentProblems(1000)).toHaveLength(100);
  });

  it("is installed once per logger, and moves to a new one when the logger changes", () => {
    const first = createTestLogger();
    installRecentProblems(first.core);
    installRecentProblems(first.core);
    expect(first.core.sinkNames().filter((name) => name.startsWith("filtered"))).toHaveLength(1);

    const second = createTestLogger();
    installRecentProblems(second.core);
    expect(first.core.sinkNames().filter((name) => name.startsWith("filtered"))).toHaveLength(0);
    second.logger.warn("AUTH_LOGIN_FAILED");
    first.logger.warn("SYNC_FAILED");
    expect(recentProblems().map((p) => p.event)).toEqual(["AUTH_LOGIN_FAILED"]);
  });
});
