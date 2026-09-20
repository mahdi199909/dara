import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newId, newTraceId, newSpanId } from "../core/ids";
import { addContextProvider, getLogger, resetRootCore } from "../root";
import { installMemoryLogger } from "../testing";
import { beginRequest, getRequestContext, recordDbQuery, runWithRequestContext, setRequestErrorCode, setRequestUser } from "./requestContext";

let memory: ReturnType<typeof installMemoryLogger>;
beforeEach(() => {
  memory = installMemoryLogger();
});
afterEach(() => memory.restore());

function request(headers: Record<string, string> = {}, url = "http://localhost:3000/api/tasks/abc123?search=secret+words&page=2"): Request {
  return new Request(url, { headers });
}

describe("beginRequest", () => {
  it("gives every request its own id and a fresh trace", () => {
    const a = beginRequest(request(), "GET", "/api/tasks/[id]");
    const b = beginRequest(request(), "GET", "/api/tasks/[id]");
    expect(a.requestId).toMatch(/^req_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a.requestId).not.toBe(b.requestId);
    expect(a.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(a.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(a.traceId).not.toBe(b.traceId);
    expect(a.parentSpanId).toBeUndefined();
  });

  it("records the path without its query string, and the route pattern separately", () => {
    const context = beginRequest(request(), "GET", "/api/tasks/[id]");
    expect(context.path).toBe("/api/tasks/abc123");
    expect(JSON.stringify(context)).not.toContain("secret");
    expect(context.route).toBe("/api/tasks/[id]");
    expect(context.method).toBe("GET");
  });

  it("joins the caller's trace when it sends a valid traceparent", () => {
    const traceId = newTraceId();
    const callerSpan = newSpanId();
    const context = beginRequest(request({ traceparent: `00-${traceId}-${callerSpan}-01` }), "POST", "/api/sync/push");
    expect(context.traceId).toBe(traceId);
    expect(context.parentSpanId).toBe(callerSpan);
    expect(context.spanId).not.toBe(callerSpan);
  });

  it("starts its own trace when traceparent is malformed", () => {
    const context = beginRequest(request({ traceparent: "not-a-traceparent" }), "GET", "/x");
    expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(context.parentSpanId).toBeUndefined();
  });

  it("keeps the app's device and sync ids only when they are well-formed ids", () => {
    const device = newId("dev");
    const sync = newId("sync");
    const good = beginRequest(request({ "x-parva-device-id": device, "x-parva-sync-id": sync }), "POST", "/api/sync/push");
    expect(good.deviceId).toBe(device);
    expect(good.syncId).toBe(sync);

    const bad = beginRequest(request({ "x-parva-device-id": "dev_x INJECTED", "x-parva-sync-id": "<script>" }), "POST", "/api/sync/push");
    expect(bad.deviceId).toBeUndefined();
    expect(bad.syncId).toBeUndefined();
  });

  it("treats a client-supplied X-Request-Id as a hint only, never as the request's id", () => {
    const context = beginRequest(request({ "x-request-id": "client-abc-123" }), "GET", "/x");
    expect(context.clientRequestId).toBe("client-abc-123");
    expect(context.requestId).not.toBe("client-abc-123");

    expect(beginRequest(request({ "x-request-id": "has spaces and <markup>" }), "GET", "/x").clientRequestId).toBeUndefined();
    expect(beginRequest(request({ "x-request-id": "x".repeat(200) }), "GET", "/x").clientRequestId).toBeUndefined();
  });

  it("copes with a request it cannot read", () => {
    const context = beginRequest(undefined, "GET", "/api/x");
    expect(context.path).toBe("");
    expect(context.requestId).toMatch(/^req_/);
  });
});

describe("the request context on log records", () => {
  it("stamps request, trace and span ids — and the layer — on every record written inside", () => {
    const context = beginRequest(request(), "POST", "/api/tasks");
    runWithRequestContext(context, () => {
      getLogger("task", "service").info("TASK_CREATE_SUCCESS", { taskId: "t1" });
    });
    expect(memory.sink.last()).toMatchObject({
      request_id: context.requestId,
      trace_id: context.traceId,
      span_id: context.spanId,
      layer: "server",
    });
  });

  it("adds the user once the handler knows who it is", () => {
    const context = beginRequest(request(), "GET", "/api/tasks");
    runWithRequestContext(context, () => {
      const log = getLogger("task", "service");
      log.info("TASK_CREATE_STARTED");
      setRequestUser("usr_42");
      log.info("TASK_CREATE_SUCCESS");
    });
    const [before, after] = memory.sink.records;
    expect(before.user_id).toBeUndefined();
    expect(after.user_id).toBe("usr_42");
  });

  it("writes nothing request-shaped outside a request", () => {
    getLogger("task", "service").info("TASK_CREATE_SUCCESS");
    const written = memory.sink.last()!;
    expect(written.request_id).toBeUndefined();
    expect(written.trace_id).toBeUndefined();
    expect(getRequestContext()).toBeUndefined();
  });

  it("keeps concurrent requests apart across awaits", async () => {
    const one = beginRequest(request(), "GET", "/api/one");
    const two = beginRequest(request(), "GET", "/api/two");
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const log = getLogger("task", "service");

    await Promise.all([
      runWithRequestContext(one, async () => {
        log.info("TASK_CREATE_STARTED", { who: "one" });
        await pause(15);
        log.info("TASK_CREATE_SUCCESS", { who: "one" });
      }),
      runWithRequestContext(two, async () => {
        await pause(5);
        log.info("TASK_CREATE_STARTED", { who: "two" });
        await pause(5);
        log.info("TASK_CREATE_SUCCESS", { who: "two" });
      }),
    ]);

    for (const record of memory.sink.records) {
      const owner = record.metadata.who === "one" ? one : two;
      expect(record.request_id).toBe(owner.requestId);
    }
    expect(memory.sink.records).toHaveLength(4);
  });

  it("still applies after the root logger was reset, because each request re-registers its provider", () => {
    resetRootCore();
    memory.restore();
    memory = installMemoryLogger();
    const context = beginRequest(request(), "GET", "/api/x");
    runWithRequestContext(context, () => getLogger("task").info("TASK_CREATE_SUCCESS"));
    expect(memory.sink.last()?.request_id).toBe(context.requestId);
  });

  it("does not double the context when a provider id is registered twice", () => {
    let calls = 0;
    const provider = () => {
      calls++;
      return { requestId: "req_static" };
    };
    addContextProvider(provider, "test.twice");
    addContextProvider(provider, "test.twice");
    getLogger("task").info("TASK_CREATE_SUCCESS");
    expect(calls).toBe(1);
  });
});

describe("request tallies", () => {
  it("counts database work against the current request", () => {
    const context = beginRequest(request(), "GET", "/api/x");
    runWithRequestContext(context, () => {
      recordDbQuery(4);
      recordDbQuery(10);
      recordDbQuery(1);
    });
    expect(context.db).toEqual({ queries: 3, totalMs: 15, slowestMs: 10 });
  });

  it("remembers the error code the response carried", () => {
    const context = beginRequest(request(), "GET", "/api/x");
    runWithRequestContext(context, () => setRequestErrorCode("AUTH-003"));
    expect(context.errorCode).toBe("AUTH-003");
  });

  it("ignores all of it outside a request instead of throwing", () => {
    expect(() => {
      recordDbQuery(5);
      setRequestUser("usr_1");
      setRequestErrorCode("SYS-001");
    }).not.toThrow();
  });
});
