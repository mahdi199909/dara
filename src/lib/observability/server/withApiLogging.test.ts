import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metrics } from "../core/metrics";
import { newId, newTraceId, newSpanId } from "../core/ids";
import { getLogger } from "../root";
import type { LogSink } from "../core/sink";
import { installMemoryLogger } from "../testing";
import { getRequestContext } from "./requestContext";
import { completionLevel, withApiLogging } from "./withApiLogging";

// handleApiError pulls in the session helpers and the database client; neither is needed here.
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => undefined, set: () => undefined }) }));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { ApiError, handleApiError } from "@/lib/apiError";
import { AuthError } from "@/lib/auth";

let memory: ReturnType<typeof installMemoryLogger>;
beforeEach(() => {
  memory = installMemoryLogger();
});
afterEach(() => {
  memory.restore();
  delete process.env.LOG_SLOW_REQUEST_MS;
  delete process.env.SLOW_API_THRESHOLD_MS;
  delete process.env.SLOW_SYNC_THRESHOLD_MS;
});

function req(method: string, path = "/api/tasks", init: RequestInit = {}): Request {
  return new Request(`http://localhost:3000${path}`, { method, ...init });
}

const ok = () => NextResponse.json({ ok: true });

/**
 * Route handlers like `GET()` declare no parameters, but Next.js always calls them with
 * (request, context) — so the tests call the wrapped handler the way Next does.
 */
function wrapped(method: string, route: string, handler: (...args: any[]) => Response | Promise<Response>) {
  return withApiLogging<any[]>(method, route, handler);
}

describe("completionLevel", () => {
  it("is quiet for a successful read, visible for a successful write, loud for failures", () => {
    expect(completionLevel("GET", 200)).toBe("DEBUG");
    expect(completionLevel("HEAD", 204)).toBe("DEBUG");
    expect(completionLevel("POST", 200)).toBe("INFO");
    expect(completionLevel("PATCH", 200)).toBe("INFO");
    expect(completionLevel("DELETE", 204)).toBe("INFO");
    expect(completionLevel("GET", 404)).toBe("WARN");
    expect(completionLevel("POST", 401)).toBe("WARN");
    expect(completionLevel("GET", 500)).toBe("ERROR");
    expect(completionLevel("POST", 503)).toBe("ERROR");
  });
});

describe("withApiLogging", () => {
  it("returns exactly what the handler returned, tagged with the request id", async () => {
    const handler = vi.fn(ok);
    const logged = wrapped("POST", "/api/tasks", handler);
    const response = await logged(req("POST"));
    expect(await response.json()).toEqual({ ok: true });
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Request-Id")).toMatch(/^req_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("passes every argument through, so route params keep working", async () => {
    const handler = vi.fn(async (_req: Request, ctx: { params: { id: string } }) => NextResponse.json({ id: ctx.params.id }));
    const logged = wrapped("GET", "/api/tasks/[id]", handler);
    const response = await logged(req("GET", "/api/tasks/t9"), { params: { id: "t9" } });
    expect(await response.json()).toEqual({ id: "t9" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("writes one completion record with method, path, status, duration and route", async () => {
    const response = await wrapped("POST", "/api/tasks", ok)(req("POST", "/api/tasks?q=private+words"));
    const [record] = memory.sink.find("HTTP_REQUEST_COMPLETED");
    expect(record).toMatchObject({
      level: "INFO",
      event: "HTTP_REQUEST_COMPLETED",
      module: "api",
      method: "POST",
      path: "/api/tasks",
      status_code: 200,
      request_id: response.headers.get("X-Request-Id"),
      layer: "server",
      metadata: { route: "/api/tasks", dbQueries: 0, dbMs: 0 },
    });
    expect(typeof record.duration_ms).toBe("number");
    expect(record.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(memory.sink.find("HTTP_REQUEST_COMPLETED")).toHaveLength(1);
  });

  it("never logs the query string, the body or the headers", async () => {
    const body = JSON.stringify({ title: "قرارداد محرمانه", amount: 987654321, password: "hunter2" });
    await wrapped("POST", "/api/tasks", async (request: Request) => {
      await request.json();
      return ok();
    })(req("POST", "/api/tasks?search=my+secret", { body, headers: { "content-type": "application/json", authorization: "Bearer abc.def.ghi", cookie: "hesabkon_session=xyz" } }));
    const written = JSON.stringify(memory.sink.records);
    for (const secret of ["my+secret", "my secret", "قرارداد", "987654321", "hunter2", "abc.def.ghi", "hesabkon_session", "xyz"]) {
      expect(written).not.toContain(secret);
    }
  });

  it("joins the trace the app started and records the app's span as the parent", async () => {
    const traceId = newTraceId();
    const callerSpan = newSpanId();
    await wrapped("POST", "/api/sync/push", ok)(req("POST", "/api/sync/push", { headers: { traceparent: `00-${traceId}-${callerSpan}-01` } }));
    const [record] = memory.sink.find("HTTP_REQUEST_COMPLETED");
    expect(record.trace_id).toBe(traceId);
    expect(record.metadata.parentSpanId).toBe(callerSpan);
  });

  it("carries the app's device and sync ids on every record of the request", async () => {
    const device = newId("dev");
    const sync = newId("sync");
    await wrapped("POST", "/api/sync/push", async () => {
      getLogger("sync", "push").info("SYNC_PUSH_SUCCESS");
      return ok();
    })(req("POST", "/api/sync/push", { headers: { "x-parva-device-id": device, "x-parva-sync-id": sync } }));
    for (const record of memory.sink.records) {
      expect(record.device_id).toBe(device);
      expect(record.sync_id).toBe(sync);
    }
    expect(memory.sink.find("SYNC_PUSH_SUCCESS")).toHaveLength(1);
  });

  it("writes a successful read only at DEBUG — absent at the production default", async () => {
    memory.restore();
    memory = installMemoryLogger({ level: "INFO" });
    await wrapped("GET", "/api/tasks", ok)(req("GET"));
    expect(memory.sink.find("HTTP_REQUEST_COMPLETED")).toEqual([]);
    expect(memory.sink.find("HTTP_REQUEST_STARTED")).toEqual([]);
  });

  it("marks 4xx as WARN and 5xx as ERROR", async () => {
    await wrapped("GET", "/api/tasks/[id]", () => NextResponse.json({ error: "x" }, { status: 404 }))(req("GET", "/api/tasks/nope"));
    await wrapped("POST", "/api/tasks", () => NextResponse.json({ error: "x" }, { status: 503 }))(req("POST"));
    const [notFound, unavailable] = memory.sink.find("HTTP_REQUEST_COMPLETED");
    expect(notFound).toMatchObject({ level: "WARN", status_code: 404 });
    expect(unavailable).toMatchObject({ level: "ERROR", status_code: 503 });
  });

  it("puts the error code of a handled failure on the completion record and in the response body", async () => {
    const logged = wrapped("GET", "/api/tasks/[id]", async () => {
      try {
        throw new ApiError("کار پیدا نشد.", 404);
      } catch (err) {
        return handleApiError(err);
      }
    });
    const response = await logged(req("GET", "/api/tasks/nope"));
    const body = await response.json();
    const [record] = memory.sink.find("HTTP_REQUEST_COMPLETED");
    expect(record).toMatchObject({ level: "WARN", status_code: 404, error_code: "DB-007" });
    expect(body).toEqual({ error: "کار پیدا نشد.", code: "DB-007", requestId: response.headers.get("X-Request-Id") });
    expect(record.request_id).toBe(body.requestId);
  });

  it("lets a route name its own code, and falls back to one for the status", async () => {
    const handler = (err: unknown) => wrapped("POST", "/api/auth/login", async () => handleApiError(err))(req("POST", "/api/auth/login"));
    const named = await handler(new ApiError("ایمیل یا رمز عبور اشتباه است.", 401, "AUTH-001"));
    const generic = await handler(new ApiError("نامعتبر", 422));
    const conflict = await handler(new ApiError("تکراری", 409));
    expect((await named.json()).code).toBe("AUTH-001");
    expect((await generic.json()).code).toBe("VAL-001");
    expect("code" in (await conflict.json())).toBe(false);
    const codes = memory.sink.find("HTTP_REQUEST_COMPLETED").map((r) => r.error_code);
    expect(codes).toEqual(["AUTH-001", "VAL-001", undefined]);
  });

  it("answers an unauthenticated request with AUTH-003 and no stack anywhere in the body", async () => {
    const response = await wrapped("GET", "/api/tasks", async () => handleApiError(new AuthError()))(req("GET"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ error: "احراز هویت نشده‌اید.", code: "AUTH-003" });
    expect(JSON.stringify(body)).not.toContain("at ");
    expect(memory.sink.find("HTTP_REQUEST_COMPLETED")[0]).toMatchObject({ level: "WARN", status_code: 401, error_code: "AUTH-003" });
  });

  it("logs an unhandled error once with its stack, and the 500 completion carries its code", async () => {
    const logged = wrapped("POST", "/api/tasks", async () => {
      try {
        throw new Error("boom: password=hunter2");
      } catch (err) {
        return handleApiError(err);
      }
    });
    const response = await logged(req("POST"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "خطایی رخ داد. دوباره تلاش کنید.", code: "SYS-001", requestId: response.headers.get("X-Request-Id") });
    const [unhandled] = memory.sink.find("API_UNHANDLED_ERROR");
    expect(unhandled).toMatchObject({ level: "ERROR", error_code: "SYS-001", request_id: body.requestId });
    expect(unhandled.error?.stack).toContain("Error:");
    expect(JSON.stringify(memory.sink.records)).not.toContain("hunter2");
    expect(memory.sink.find("HTTP_REQUEST_COMPLETED")[0]).toMatchObject({ level: "ERROR", status_code: 500, error_code: "SYS-001" });
    expect(memory.sink.find("API_UNHANDLED_ERROR")).toHaveLength(1);
  });

  it("logs a handler that throws, rethrows the same error, and reports a 500", async () => {
    const failure = new Error("nobody caught me");
    const logged = wrapped("GET", "/api/x", () => {
      throw failure;
    });
    await expect(logged(req("GET", "/api/x"))).rejects.toBe(failure);
    expect(memory.sink.find("API_UNHANDLED_ERROR")).toHaveLength(1);
    expect(memory.sink.find("HTTP_REQUEST_COMPLETED")[0]).toMatchObject({ level: "ERROR", status_code: 500, error_code: "SYS-001" });
  });

  it("classifies a thrown database error", async () => {
    const logged = wrapped("POST", "/api/x", async () => {
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    });
    await expect(logged(req("POST", "/api/x"))).rejects.toThrow();
    expect(memory.sink.find("HTTP_REQUEST_COMPLETED")[0].error_code).toBe("DB-005");
  });

  it("adds a slow-request warning when the threshold is crossed", async () => {
    process.env.LOG_SLOW_REQUEST_MS = "20";
    await wrapped("GET", "/api/slow", async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return ok();
    })(req("GET", "/api/slow"));
    const [slow] = memory.sink.find("API_SLOW_REQUEST");
    expect(slow).toMatchObject({ level: "WARN", path: "/api/slow", status_code: 200, metadata: { thresholdMs: 20, route: "/api/slow" } });
    expect(slow.duration_ms).toBeGreaterThanOrEqual(20);

    memory.sink.clear();
    process.env.LOG_SLOW_REQUEST_MS = "5000";
    await wrapped("GET", "/api/fast", ok)(req("GET", "/api/fast"));
    expect(memory.sink.find("API_SLOW_REQUEST")).toEqual([]);
  });

  it("takes the threshold from SLOW_API_THRESHOLD_MS, which wins over the older LOG_SLOW_REQUEST_MS", async () => {
    process.env.LOG_SLOW_REQUEST_MS = "5000";
    process.env.SLOW_API_THRESHOLD_MS = "10";
    await wrapped("GET", "/api/slow", async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return ok();
    })(req("GET", "/api/slow"));
    expect(memory.sink.find("API_SLOW_REQUEST")[0]).toMatchObject({ metadata: { thresholdMs: 10 } });
  });

  it("counts every slow request by route, for the slow-requests panel", async () => {
    process.env.SLOW_API_THRESHOLD_MS = "5";
    const slow = metrics.counter("http_slow_requests_total");
    const before = slow.value({ route: "/api/slowcount" });
    for (let i = 0; i < 2; i++) {
      await wrapped("GET", "/api/slowcount", async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return ok();
      })(req("GET", "/api/slowcount"));
    }
    expect(slow.value({ route: "/api/slowcount" }) - before).toBe(2);
  });

  it("gives a sync request its own, more patient threshold and its own event", async () => {
    process.env.SLOW_API_THRESHOLD_MS = "5";
    process.env.SLOW_SYNC_THRESHOLD_MS = "30";
    const pause = (ms: number) => async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ok();
    };
    await wrapped("POST", "/api/sync/push", pause(15))(req("POST", "/api/sync/push")); // slow for an API call, not for a sync
    expect(memory.sink.find("SYNC_SLOW")).toEqual([]);
    expect(memory.sink.find("API_SLOW_REQUEST")).toEqual([]);

    await wrapped("POST", "/api/sync/push", pause(45))(req("POST", "/api/sync/push"));
    expect(memory.sink.find("SYNC_SLOW")[0]).toMatchObject({ level: "WARN", module: "sync", path: "/api/sync/push", metadata: { thresholdMs: 30, route: "/api/sync/push" } });
    expect(memory.sink.find("API_SLOW_REQUEST")).toEqual([]); // one warning, not two
  });

  it("gives concurrent requests distinct ids, each on its own records", async () => {
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const logged = wrapped("POST", "/api/tasks", async (request: Request) => {
      const who = new URL(request.url).searchParams.get("who");
      await pause(who === "a" ? 20 : 5);
      getLogger("task", "service").info("TASK_CREATE_SUCCESS", { who });
      return ok();
    });
    const [a, b] = await Promise.all([logged(req("POST", "/api/tasks?who=a")), logged(req("POST", "/api/tasks?who=b"))]);
    const idA = a.headers.get("X-Request-Id");
    const idB = b.headers.get("X-Request-Id");
    expect(idA).not.toBe(idB);
    for (const record of memory.sink.find("TASK_CREATE_SUCCESS")) {
      expect(record.request_id).toBe(record.metadata.who === "a" ? idA : idB);
    }
  });

  it("exposes the request context to the handler", async () => {
    let seen: string | undefined;
    const response = await wrapped("GET", "/api/x", () => {
      seen = getRequestContext()?.requestId;
      return ok();
    })(req("GET", "/api/x"));
    expect(seen).toBe(response.headers.get("X-Request-Id"));
    expect(getRequestContext()).toBeUndefined();
  });

  it("counts requests and times them for /metrics", async () => {
    const route = "/api/metrics-probe";
    const before = metrics.counter("http_requests_total").value({ method: "GET", route, status: "2xx" });
    await wrapped("GET", route, ok)(req("GET", route));
    await wrapped("GET", route, ok)(req("GET", route));
    expect(metrics.counter("http_requests_total").value({ method: "GET", route, status: "2xx" })).toBe(before + 2);
    expect(metrics.toPrometheus()).toContain(`http_request_duration_ms_count{method="GET",route="${route}"} `);
  });

  it("does not let a broken log sink break the request", async () => {
    memory.restore();
    const throwing: LogSink = {
      name: "throwing",
      write() {
        throw new Error("disk on fire");
      },
    };
    memory = installMemoryLogger({ sinks: [throwing] });
    const response = await wrapped("POST", "/api/tasks", ok)(req("POST"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("copes with a response whose headers are read-only", async () => {
    const response = await wrapped("GET", "/api/go", () => Response.redirect("http://localhost:3000/elsewhere", 302))(req("GET", "/api/go"));
    expect(response.status).toBe(302);
    expect(memory.sink.find("HTTP_REQUEST_COMPLETED")[0]).toMatchObject({ status_code: 302, level: "DEBUG" });
  });

  it("stays out of the way during `next build`, which calls GET handlers only to learn whether they can be prerendered", async () => {
    process.env.NEXT_PHASE = "phase-production-build";
    try {
      const response = await wrapped("GET", "/api/probe", ok)(req("GET", "/api/probe"));
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Request-Id")).toBeNull();
      expect(memory.sink.records).toEqual([]);
    } finally {
      delete process.env.NEXT_PHASE;
    }
  });

  it("does not report Next's own dynamic-usage signal as an unhandled error, and still answers as before", async () => {
    const signal = Object.assign(new Error("Dynamic server usage: Route /api/x couldn't be rendered statically because it used `cookies`."), { digest: "DYNAMIC_SERVER_USAGE" });
    const response = await wrapped("GET", "/api/x", async () => handleApiError(signal))(req("GET", "/api/x"));
    expect(response.status).toBe(500);
    expect(memory.sink.find("API_UNHANDLED_ERROR")).toEqual([]);
  });

  it("still runs the handler when the request cannot be read", async () => {
    const handler = vi.fn(ok);
    const hostile = { get url(): string { throw new Error("no url for you"); }, get headers(): Headers { throw new Error("no headers either"); } };
    const response = await wrapped("GET", "/api/x", handler)(hostile as unknown as Request);
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
