import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseTraceparent } from "./observability/core/trace";
import { setClientDeviceId } from "./observability/client/clientContext";
import { installMemoryLogger } from "./observability/testing";
import { CORRELATION_RETRY_AFTER_MS, correlationHeaders, correlationRefused, remoteFetch, resetRemoteFetchState } from "./remoteFetch";

const DEVICE = "dev_01J8ZQ2M3N4P5R6S7T8V9W0X1Y";
const SYNC = "sync_01J8ZQ2M3N4P5R6S7T8V9W0X1Y";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

let memory: ReturnType<typeof installMemoryLogger>;
beforeEach(() => {
  resetRemoteFetchState();
  setClientDeviceId(DEVICE);
  memory = installMemoryLogger();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setClientDeviceId(undefined);
  memory.restore();
});

const ok = () => new Response("{}", { status: 200 });
const headersOf = (call: unknown[]) => new Headers((call[1] as RequestInit | undefined)?.headers as HeadersInit);

/** What a browser does when the server's preflight does not list a header: the request never leaves, and fetch rejects like offline. */
function serverThatPredatesTheHeaders() {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const sent = new Headers(init?.headers as HeadersInit);
    if (sent.has("x-parva-sync-id") || sent.has("x-parva-device-id") || sent.has("traceparent")) throw new TypeError("Failed to fetch");
    return ok();
  });
}

describe("the headers", () => {
  it("adds the trace, the device and the sync cycle, and keeps the caller's own headers", async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal("fetch", fetchMock);
    await remoteFetch("https://server.test/api/sync/push", { method: "POST", headers: { Authorization: "Bearer t", "Content-Type": "application/json" }, body: "{}" }, { syncId: SYNC, traceId: TRACE });

    const sent = headersOf(fetchMock.mock.calls[0]);
    expect(sent.get("authorization")).toBe("Bearer t");
    expect(sent.get("content-type")).toBe("application/json");
    expect(sent.get("x-parva-device-id")).toBe(DEVICE);
    expect(sent.get("x-parva-sync-id")).toBe(SYNC);
    const trace = parseTraceparent(sent.get("traceparent"));
    expect(trace?.traceId).toBe(TRACE); // the cycle's trace; the server's span is a child of ours
    expect(trace?.parentSpanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("gives every request of a cycle its own span in the same trace", () => {
    const first = parseTraceparent(correlationHeaders({ syncId: SYNC, traceId: TRACE }).traceparent);
    const second = parseTraceparent(correlationHeaders({ syncId: SYNC, traceId: TRACE }).traceparent);
    expect(first?.traceId).toBe(second?.traceId);
    expect(first?.parentSpanId).not.toBe(second?.parentSpanId);
  });

  it("starts a trace of its own for a request that belongs to no cycle, and sends no sync id", () => {
    const headers = correlationHeaders();
    expect(parseTraceparent(headers.traceparent)?.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(headers["X-Parva-Sync-Id"]).toBeUndefined();
  });

  it("leaves the device out until the app has one (the web app never has)", () => {
    setClientDeviceId(undefined);
    expect(correlationHeaders({ syncId: SYNC })["X-Parva-Device-Id"]).toBeUndefined();
  });

  it("sends nothing but ids: no token, no e-mail, no data", () => {
    const text = JSON.stringify(correlationHeaders({ syncId: SYNC, traceId: TRACE }));
    expect(text).not.toMatch(/Bearer|@|token/i);
  });

  it("merges headers given as a Headers object or as pairs", async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal("fetch", fetchMock);
    await remoteFetch("https://server.test/a", { headers: new Headers({ Authorization: "Bearer a" }) });
    await remoteFetch("https://server.test/b", { headers: [["Authorization", "Bearer b"]] });
    expect(headersOf(fetchMock.mock.calls[0]).get("authorization")).toBe("Bearer a");
    expect(headersOf(fetchMock.mock.calls[1]).get("authorization")).toBe("Bearer b");
    expect(headersOf(fetchMock.mock.calls[1]).get("x-parva-device-id")).toBe(DEVICE);
  });
});

describe("a server that predates the headers", () => {
  it("still gets the request — once, without them — and the request succeeds", async () => {
    const fetchMock = serverThatPredatesTheHeaders();
    vi.stubGlobal("fetch", fetchMock);
    const response = await remoteFetch("https://old.test/api/sync/pull", { headers: { Authorization: "Bearer t" } }, { syncId: SYNC, traceId: TRACE });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(headersOf(fetchMock.mock.calls[1]).has("x-parva-sync-id")).toBe(false);
    expect(headersOf(fetchMock.mock.calls[1]).get("authorization")).toBe("Bearer t");
    expect(memory.sink.find("SYNC_CORRELATION_UNSUPPORTED")).toHaveLength(1);
    expect(correlationRefused()).toBe(true);
  });

  it("does not ask again for half an hour: later requests go straight out without the headers", async () => {
    const fetchMock = serverThatPredatesTheHeaders();
    vi.stubGlobal("fetch", fetchMock);
    await remoteFetch("https://old.test/a", {}, { syncId: SYNC });
    fetchMock.mockClear();
    await remoteFetch("https://old.test/b", {}, { syncId: SYNC });
    await remoteFetch("https://old.test/c", {}, { syncId: SYNC });
    expect(fetchMock).toHaveBeenCalledTimes(2); // one attempt each, no failed first try
    expect(memory.sink.find("SYNC_CORRELATION_UNSUPPORTED")).toHaveLength(1);
  });

  it("tries the headers again after half an hour, so a server that was upgraded is noticed without restarting the app", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
    const fetchMock = serverThatPredatesTheHeaders();
    vi.stubGlobal("fetch", fetchMock);
    await remoteFetch("https://server.test/a", {}, { syncId: SYNC });
    expect(correlationRefused()).toBe(true);

    vi.setSystemTime(Date.now() + CORRELATION_RETRY_AFTER_MS + 1000);
    expect(correlationRefused()).toBe(false);
    const upgraded = vi.fn(async () => ok());
    vi.stubGlobal("fetch", upgraded);
    await remoteFetch("https://server.test/b", {}, { syncId: SYNC });
    expect(headersOf(upgraded.mock.calls[0]).get("x-parva-sync-id")).toBe(SYNC); // it went out with them
    expect(correlationRefused()).toBe(false);
  });
});

describe("failures that are not about the headers", () => {
  it("reports being offline as it always did: the same error, not remembered as a refusal", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(remoteFetch("https://server.test/a", {}, { syncId: SYNC })).rejects.toThrow("Failed to fetch");
    expect(fetchMock).toHaveBeenCalledTimes(2); // the attempt, and the plain retry that also failed
    expect(correlationRefused()).toBe(false); // so the next request still sends the headers first
    expect(memory.sink.find("SYNC_CORRELATION_UNSUPPORTED")).toEqual([]);
  });

  it("does not retry a request that was aborted", async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(remoteFetch("https://server.test/a")).rejects.toThrow("aborted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hands a 4xx or 5xx back to the caller as any other response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const response = await remoteFetch("https://server.test/a", {}, { syncId: SYNC });
    expect(response.status).toBe(503);
    expect(correlationRefused()).toBe(false);
  });
});
