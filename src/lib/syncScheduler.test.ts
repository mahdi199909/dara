import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syncWithServer = vi.fn();
vi.mock("./nativeOnboarding", () => ({ syncWithServer: (...a: unknown[]) => syncWithServer(...a) }));
vi.mock("swr", () => ({ mutate: vi.fn() }));

import { noteLocalWrite, startForegroundPolling } from "./syncScheduler";

beforeEach(() => {
  vi.useFakeTimers();
  syncWithServer.mockReset();
  syncWithServer.mockResolvedValue({ ok: true, pulledCount: 0, deletionsPulled: 0 });
  vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true } });
  vi.stubGlobal("document", { visibilityState: "visible" });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("noteLocalWrite", () => {
  it("turns a burst of edits into one sync a few seconds after the last one", async () => {
    noteLocalWrite();
    await vi.advanceTimersByTimeAsync(1500);
    noteLocalWrite();
    await vi.advanceTimersByTimeAsync(1500);
    noteLocalWrite();
    await vi.advanceTimersByTimeAsync(2900);
    expect(syncWithServer).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(syncWithServer).toHaveBeenCalledTimes(1);
  });

  it("does nothing outside the Android app", async () => {
    vi.stubGlobal("window", {});
    noteLocalWrite();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(syncWithServer).not.toHaveBeenCalled();
  });
});

describe("startForegroundPolling", () => {
  it("pulls periodically while the app is visible, and stops when told to", async () => {
    const stop = startForegroundPolling();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(syncWithServer).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(syncWithServer).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(syncWithServer).toHaveBeenCalledTimes(2);
  });

  it("stays quiet while the page is hidden", async () => {
    vi.stubGlobal("document", { visibilityState: "hidden" });
    const stop = startForegroundPolling();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(syncWithServer).not.toHaveBeenCalled();
    stop();
  });

  it("refreshes what's on screen when a sync brought something in", async () => {
    const { mutate } = await import("swr");
    syncWithServer.mockResolvedValue({ ok: true, pulledCount: 3, deletionsPulled: 0 });
    const stop = startForegroundPolling();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(mutate).toHaveBeenCalled();
    stop();
  });
});
