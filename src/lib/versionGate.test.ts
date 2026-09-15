import { describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: store.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      store.set(key, value);
    }),
  },
}));

import { checkVersionGate, cacheVersionGate } from "./versionGate";
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

describe("checkVersionGate", () => {
  it("never blocks when no release has been configured yet (nulls)", async () => {
    store.clear();
    await cacheVersionGate(statusWith({}));
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
    expect(await checkVersionGate(65)).toEqual({ blocked: false, updateAvailable: true, downloadUrl: "https://x/apk" });
  });

  it("reports neither block nor nag once the installed build matches latest", async () => {
    store.clear();
    await cacheVersionGate(statusWith({ latestVersionCode: 70, minSupportedVersionCode: 65, downloadUrl: "https://x/apk" }));
    expect(await checkVersionGate(70)).toEqual({ blocked: false, updateAvailable: false });
  });
});
