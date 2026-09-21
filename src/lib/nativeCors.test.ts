// The phone calls the server from a WebView with another origin, so the browser asks the server's permission (a
// preflight) for every header it sends. A header the server does not list makes the browser refuse the request — and
// fetch() reports that like being offline. These tests keep the two lists from drifting apart: every header the app
// sends must be one the server allows, on every route the phone calls.
import { describe, expect, it, vi } from "vitest";
import { corsPreflight } from "./nativeCors";
import { correlationHeaders } from "./remoteFetch";
import { setClientDeviceId } from "./observability/client/clientContext";

vi.mock("next/headers", () => ({ cookies: () => ({ get: () => undefined }) }));

const allowedBy = (response: Response) =>
  (response.headers.get("access-control-allow-headers") ?? "")
    .toLowerCase()
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

const ROUTES = [
  "auth/login",
  "auth/register",
  "license/status",
  "sync/push",
  "sync/pull",
] as const;

describe("what the server lets the phone send", () => {
  it("allows every header the app adds to a request, and the two it always sends", () => {
    setClientDeviceId("dev_01J8ZQ2M3N4P5R6S7T8V9W0X1Y");
    try {
      const allowed = allowedBy(corsPreflight());
      const sent = Object.keys(correlationHeaders({ syncId: "sync_01J8ZQ2M3N4P5R6S7T8V9W0X1Y", traceId: "4bf92f3577b34da6a3ce929d0e0e4736" }));
      expect(sent.length).toBeGreaterThanOrEqual(3); // traceparent, device id, sync id
      for (const header of [...sent, "Authorization", "Content-Type"]) expect(allowed, header).toContain(header.toLowerCase());
    } finally {
      setClientDeviceId(undefined);
    }
  });

  it("lets the app read the server's request id from a response", () => {
    expect((corsPreflight().headers.get("access-control-expose-headers") ?? "").toLowerCase()).toContain("x-request-id");
  });

  it.each(ROUTES)("answers the preflight for /api/%s with the same list", async (route) => {
    const routeModule = await import(`@/app/api/${route}/route`);
    expect(typeof routeModule.OPTIONS, route).toBe("function");
    const response: Response = await routeModule.OPTIONS();
    expect(response.status).toBe(204);
    expect(allowedBy(response)).toEqual(allowedBy(corsPreflight()));
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});
