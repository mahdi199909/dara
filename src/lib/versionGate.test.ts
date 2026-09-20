import { afterEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: store.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      store.set(key, value);
    }),
  },
}));

import { checkVersionGate, cacheVersionGate, refreshVersionGate } from "./versionGate";
import type { RemoteLicenseStatus } from "./remoteAuth";

function statusWith(fields: Partial<RemoteLicenseStatus>): RemoteLicenseStatus {
  return {
    status: "SUBSCRIBED",
    trialDaysRemaining: null,
    trialEndsAt: null,
    currentPeriodEnd: null,
    latestVersionCode: null,
    minSupportedVersionCode: null,
    downloadUrl: null,
    ...fields,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkVersionGate", () => {
  it("never blocks when no release has been configured yet (nulls)", async () => {
    store.clear();
    await cacheVersionGate(statusWith({}));
    expect(await checkVersionGate(1)).toEqual({ blocked: false, updateAvailable: false });
  });

  it("never blocks or nags before the app has heard from the server at all", async () => {
    store.clear();
    expect(await checkVersionGate(1)).toEqual({ blocked: false, updateAvailable: false });
  });

  it("blocks when the installed build is below the configured minimum", async () => {
    store.clear();
    await cacheVersionGate(statusWith({ latestVersionCode: 70, minSupportedVersionCode: 65, downloadUrl: "https://x/apk" }));
    expect(await checkVersionGate(60)).toEqual({ blocked: true, downloadUrl: "https://x/apk" });
  });

  it("does not block a build exactly at the minimum, but flags an update as available", async () => {
    store.clear();
    await cacheVersionGate(statusWith({ latestVersionCode: 70, minSupportedVersionCode: 65, downloadUrl: "https://x/apk" }));
    expect(await checkVersionGate(65)).toEqual({
      blocked: false,
      updateAvailable: true,
      downloadUrl: "https://x/apk",
      latestVersionCode: 70,
      latestVersionName: null,
    });
  });

  it("reports neither block nor nag once the installed build matches latest", async () => {
    store.clear();
    await cacheVersionGate(statusWith({ latestVersionCode: 70, minSupportedVersionCode: 65, downloadUrl: "https://x/apk" }));
    expect(await checkVersionGate(70)).toEqual({ blocked: false, updateAvailable: false });
  });

  it("never tells a build that is ahead of the announced release to update", async () => {
    store.clear();
    await cacheVersionGate(statusWith({ latestVersionCode: 10100, minSupportedVersionCode: 1, downloadUrl: "https://x/apk" }));
    expect(await checkVersionGate(10200)).toEqual({ blocked: false, updateAvailable: false });
  });

  it("names the newest version from its code when the server did not send a name", async () => {
    store.clear();
    await cacheVersionGate(statusWith({ latestVersionCode: 10100, minSupportedVersionCode: 1, downloadUrl: "https://x/apk" }));
    expect(await checkVersionGate(41)).toMatchObject({ updateAvailable: true, latestVersionName: "1.1.0", latestVersionCode: 10100 });
  });
});

describe("refreshVersionGate (the public update check)", () => {
  it("caches what the server announces, so an old install is told about the new release without any login", async () => {
    store.clear();
    const fetchMock = vi.fn(async (_url: string) =>
      new Response(
        JSON.stringify({ latestVersionName: "1.1.0", latestVersionCode: 10100, minSupportedVersionCode: 1, downloadUrl: "https://my.parvaapp.ir/parvaapp.apk" }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await refreshVersionGate()).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/app\/version$/);
    expect(await checkVersionGate(45)).toEqual({
      blocked: false,
      updateAvailable: true,
      downloadUrl: "https://my.parvaapp.ir/parvaapp.apk",
      latestVersionCode: 10100,
      latestVersionName: "1.1.0",
    });
    expect(await checkVersionGate(10100)).toEqual({ blocked: false, updateAvailable: false });
  });

  it("keeps the last answer when the server cannot be reached, and never throws", async () => {
    store.clear();
    await cacheVersionGate(statusWith({ latestVersionCode: 70, minSupportedVersionCode: 1, downloadUrl: "https://x/apk" }));
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await refreshVersionGate()).toBe(false);
    expect(await checkVersionGate(60)).toMatchObject({ updateAvailable: true, latestVersionCode: 70 });
  });

  it("keeps the last answer when the server answers with an error (an older server build has no such route)", async () => {
    store.clear();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "not found" }), { status: 404 })));
    expect(await refreshVersionGate()).toBe(false);
    expect(await checkVersionGate(1)).toEqual({ blocked: false, updateAvailable: false });
  });
});
