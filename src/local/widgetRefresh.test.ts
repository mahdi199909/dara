import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writeCapitalWidgetSummary = vi.fn(async () => {});
vi.mock("./reportEngine", () => ({ writeCapitalWidgetSummary: (...args: unknown[]) => writeCapitalWidgetSummary(...(args as [])) }));
const publishEventsToWidget = vi.fn(async () => {});
vi.mock("./widgetEvents", () => ({ publishEventsToWidget: (...args: unknown[]) => publishEventsToWidget(...(args as [])) }));

import type { LocalDb } from "./db";
import { WIDGET_REFRESH_MIN_INTERVAL_MS, requestWidgetRefresh, resetWidgetRefreshForTests, scheduleWidgetRefresh } from "./widgetRefresh";
import { installMemoryLogger } from "../lib/observability/testing";

const db = {} as LocalDb;

describe("widget refresh", () => {
  const refresh = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    resetWidgetRefreshForTests();
    refresh.mockClear();
    writeCapitalWidgetSummary.mockClear();
    publishEventsToWidget.mockClear();
    vi.stubGlobal("window", { AndroidWidgets: { refresh } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does nothing outside the Android app", async () => {
    vi.stubGlobal("window", {});
    scheduleWidgetRefresh(db);
    requestWidgetRefresh();
    await vi.runAllTimersAsync();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("updates the capital summary and the events list, then repaints, once the database was saved", async () => {
    scheduleWidgetRefresh(db);
    await vi.runAllTimersAsync();
    expect(writeCapitalWidgetSummary).toHaveBeenCalledTimes(1);
    expect(publishEventsToWidget).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("turns a burst of saves into one repaint", async () => {
    scheduleWidgetRefresh(db);
    scheduleWidgetRefresh(db);
    scheduleWidgetRefresh(db);
    await vi.runAllTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not repaint more often than the minimum interval, but still honours the last save", async () => {
    let clock = 10_000;
    scheduleWidgetRefresh(db, () => clock);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Another save 100 ms later must wait out the rest of the interval.
    clock += 100;
    scheduleWidgetRefresh(db, () => clock);
    await vi.advanceTimersByTimeAsync(WIDGET_REFRESH_MIN_INTERVAL_MS - 200);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("still publishes the events and repaints when computing the capital summary fails", async () => {
    writeCapitalWidgetSummary.mockRejectedValueOnce(new Error("boom"));
    const memory = installMemoryLogger();
    scheduleWidgetRefresh(db);
    await vi.runAllTimersAsync();
    expect(publishEventsToWidget).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    memory.restore();
    expect(memory.sink.find("WIDGET_REFRESH_FAILED")).toEqual([expect.objectContaining({ level: "ERROR", error_code: "WIDGET-002", metadata: { step: "capital_summary" } })]);
  });

  it("still repaints when publishing the events fails", async () => {
    publishEventsToWidget.mockRejectedValueOnce(new Error("boom"));
    const memory = installMemoryLogger();
    scheduleWidgetRefresh(db);
    await vi.runAllTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(1);
    memory.restore();
    expect(memory.sink.find("WIDGET_REFRESH_FAILED")).toEqual([expect.objectContaining({ metadata: { step: "events_payload" } })]);
  });

  it("requestWidgetRefresh repaints immediately", () => {
    requestWidgetRefresh();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
