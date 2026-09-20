import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// vi.mock is hoisted above everything, so the stand-ins it hands out must be hoisted with it.
const { findUnique, create, update } = vi.hoisted(() => ({ findUnique: vi.fn(), create: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { appRelease: { findUnique, create, update } } }));
vi.mock("@/lib/admin", () => ({ requireAdmin: vi.fn(async () => ({ id: "admin" })) }));

import { getAppRelease } from "@/lib/appRelease";
import { APK_STATIC_URL, LATEST_APP_RELEASE, LATEST_APP_VERSION_CODE } from "@/lib/appVersion";
import { GET, OPTIONS } from "@/app/api/app/version/route";
import { GET as adminGet, PATCH as adminPatch } from "@/app/api/admin/release/route";
import { middleware } from "@/middleware";

beforeEach(() => {
  findUnique.mockReset();
  create.mockReset();
  update.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getAppRelease", () => {
  it("answers with the release that ships in code when no admin row exists", async () => {
    findUnique.mockResolvedValue(null);
    expect(await getAppRelease()).toMatchObject({ latestVersionName: LATEST_APP_RELEASE.versionName, latestVersionCode: LATEST_APP_VERSION_CODE, downloadUrl: APK_STATIC_URL });
  });

  it("still answers when the row cannot be read", async () => {
    findUnique.mockRejectedValue(new Error("db down"));
    expect((await getAppRelease()).latestVersionCode).toBe(LATEST_APP_VERSION_CODE);
  });
});

describe("GET /api/app/version", () => {
  it("is readable from the app's WebView (CORS), never cached, and carries no user data", async () => {
    findUnique.mockResolvedValue({ id: "singleton", latestVersionCode: 1, minSupportedVersionCode: 1, downloadUrl: "", updatedAt: new Date() });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      latestVersionName: LATEST_APP_RELEASE.versionName,
      latestVersionCode: LATEST_APP_VERSION_CODE,
      minSupportedVersionCode: 1,
      downloadUrl: APK_STATIC_URL,
    });
  });

  it("answers the browser's preflight", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("gets past the auth middleware without a session — the login redirect and the 401 stay for everything else", async () => {
    const open = await middleware(new NextRequest("https://my.parvaapp.ir/api/app/version"));
    expect(open.status).toBe(200);
    const closed = await middleware(new NextRequest("https://my.parvaapp.ir/api/tasks"));
    expect(closed.status).toBe(401);
  });
});

describe("the admin's version control", () => {
  it("shows what the apps are being told and starts as a no-op row", async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({ id: "singleton", latestVersionCode: 1, minSupportedVersionCode: 1, downloadUrl: "" });
    const body = await (await adminGet()).json();
    expect(create).toHaveBeenCalledWith({ data: { id: "singleton", latestVersionCode: 1, minSupportedVersionCode: 1, downloadUrl: "" } });
    expect(body.effective).toMatchObject({ latestVersionCode: LATEST_APP_VERSION_CODE, minSupportedVersionCode: 1, downloadUrl: APK_STATIC_URL });
  });

  function patch(body: unknown) {
    return adminPatch(new NextRequest("https://my.parvaapp.ir/api/admin/release", { method: "PATCH", body: JSON.stringify(body) }));
  }

  it("saves a minimum-version lock-out, and an empty link means the permanent link", async () => {
    findUnique.mockResolvedValue({ id: "singleton" });
    update.mockImplementation(async ({ data }: { data: object }) => ({ id: "singleton", ...data }));
    const res = await patch({ latestVersionCode: 10100, minSupportedVersionCode: 10000, downloadUrl: "" });
    expect(res.status).toBe(200);
    expect((await res.json()).effective).toMatchObject({ minSupportedVersionCode: 10000, downloadUrl: APK_STATIC_URL });
  });

  it("refuses a link that is not http(s), and a minimum above the newest version", async () => {
    findUnique.mockResolvedValue({ id: "singleton" });
    expect((await patch({ latestVersionCode: 10100, minSupportedVersionCode: 1, downloadUrl: "javascript:alert(1)" })).status).toBeGreaterThanOrEqual(400);
    expect((await patch({ latestVersionCode: 10100, minSupportedVersionCode: 10200, downloadUrl: "" })).status).toBe(422);
    expect(update).not.toHaveBeenCalled();
  });
});
