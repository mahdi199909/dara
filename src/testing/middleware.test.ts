import { NextRequest } from "next/server";
import { adminEmails } from "@/lib/adminIdentity";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
// Lives in src/testing: the Android export deletes src/middleware.ts, and this file with it.
import { middleware } from "../middleware";

const call = (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) => middleware(new NextRequest(`http://localhost:3000${path}`, init));
/** NextResponse.next() — the request goes on to its route. */
const passesOn = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("which API paths need a session", () => {
  it("lets a metrics scraper reach /api/metrics without one: the route guards itself with its own bearer token", async () => {
    expect(passesOn(await call("/api/metrics"))).toBe(true);
    expect(passesOn(await call("/api/metrics", { headers: { authorization: "Bearer not-a-session-token" } }))).toBe(true);
  });

  it("does not make anything else public for starting with the same letters", async () => {
    for (const path of ["/api/metrics-private", "/api/metrics/extra", "/api/metricsfoo"]) {
      const res = await call(path);
      expect(passesOn(res), path).toBe(false);
      expect(res.status, path).toBe(401);
    }
  });

  it("still refuses the owner's routes, and the rest of the API, without a session — with the code and a request id", async () => {
    for (const path of ["/api/admin/health", "/api/admin/logs", "/api/admin/logging", "/api/tasks", "/api/sync/pull"]) {
      const res = await call(path);
      expect(res.status, path).toBe(401);
      expect(await res.json()).toMatchObject({ code: "AUTH-003", requestId: expect.stringMatching(/^req_/) });
    }
  });

  it("lets anyone download the app, signed in or not", async () => {
    expect(passesOn(await call("/parvaapp.apk"))).toBe(true);
    expect(passesOn(await call("/api/app/apk"))).toBe(true);
  });

  async function tokenFor(email: string): Promise<string> {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || "dev-only-secret-change-me-in-production");
    return new SignJWT({ userId: "someone", email }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(secret);
  }

  it("lets the owner's signed-in request through to the owner's routes (the route then checks the account itself)", async () => {
    const token = await tokenFor(adminEmails()[0]);
    expect(passesOn(await call("/api/admin/health", { headers: { authorization: `Bearer ${token}` } }))).toBe(true);
  });

  it("turns anyone else away from the owner's routes and pages before any route code runs", async () => {
    const token = await tokenFor("someone.else@example.test");
    const api = await call("/api/admin/health", { headers: { authorization: `Bearer ${token}` } });
    expect(passesOn(api)).toBe(false);
    expect(api.status).toBe(403);
    for (const page of ["/dashboard", "/dashboard/users", "/admin"]) {
      const res = await call(page, { headers: { authorization: `Bearer ${token}` } });
      expect(res.status, page).toBe(404);
      const anonymous = await call(page);
      expect(anonymous.status, page + " without a session").toBe(307);
      expect(anonymous.headers.get("location"), page).toContain("/login");
    }
  });
});
