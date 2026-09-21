import { describe, expect, it } from "vitest";
import { metrics } from "./metrics";
import { countReportRows, startReport } from "./reportRun";
import { isErrorReported } from "./reportedErrors";
import { createTestLogger } from "../testing";

function setup(slowMs = 2000) {
  const test = createTestLogger();
  let now = 1000;
  const options = { slowMs, layer: "server" as const, clock: () => now };
  return { ...test, tick: (ms: number) => void (now += ms), options };
}
const runs = (report: string, outcome: string) => metrics.counter("reports_total").value({ report, outcome });
const timed = (report: string) => metrics.histogram("report_duration_ms").entries().find((e) => e.labels === `report="${report}"`)?.count ?? 0;

const RANGE = { from: new Date("2026-08-23T20:30:00.000Z"), to: new Date("2026-09-22T20:29:59.999Z") };

describe("countReportRows", () => {
  it("adds up the lists in a report, a few levels down, and counts nothing else", () => {
    const result = { report: { timeByCategory: [1, 2, 3], expenseByCategory: [1], income: 5_000_000, from: new Date() }, netWorth: { assets: [1, 2] }, narrative: "text", label: "این ماه" };
    expect(countReportRows(result)).toBe(6);
  });

  it("counts a bare list, and copes with nothing, primitives and hostile shapes", () => {
    expect(countReportRows([1, 2, 3, 4])).toBe(4);
    for (const value of [undefined, null, 5, "x", new Date(), {}, []]) expect(countReportRows(value)).toBe(0);
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 20; i++) cursor = (cursor.next = { rows: [1] }) as Record<string, unknown>;
    expect(countReportRows(deep)).toBeLessThanOrEqual(3); // bounded depth
    const cyclic: Record<string, unknown> = { rows: [1, 2] };
    cyclic.self = cyclic;
    expect(countReportRows(cyclic)).toBe(2 + 2 + 2); // and it terminates
  });
});

describe("startReport", () => {
  it("writes STARTED at debug, and COMPLETED with the period, the row count and the duration — no figures", () => {
    const { logger, sink, tick, options } = setup();
    const run = startReport(logger, "time_and_money", RANGE, options);
    expect(sink.find("REPORT_GENERATION_STARTED")[0]).toMatchObject({ level: "DEBUG", layer: "server", metadata: { report: "time_and_money", dateRange: { from: "2026-08-23T20:30:00.000Z", to: "2026-09-22T20:29:59.999Z" } } });
    tick(180.456);
    run.completed({ report: { income: 12_345_678, timeByCategory: [{ name: "کار محرمانه" }, {}] }, label: "این ماه" });

    const [done] = sink.find("REPORT_GENERATION_COMPLETED");
    expect(done).toMatchObject({ level: "INFO", duration_ms: 180.46, layer: "server", metadata: { report: "time_and_money", recordCount: 2, dateRange: { from: "2026-08-23T20:30:00.000Z" } } });
    expect(sink.find("REPORT_SLOW")).toEqual([]);
    const written = JSON.stringify(sink.records);
    expect(written).not.toContain("12345678");
    expect(written).not.toContain("محرمانه");
  });

  it("adds REPORT_SLOW at warn once the threshold is reached, with the same facts", () => {
    const { logger, sink, tick, options } = setup(2000);
    const run = startReport(logger, "time_and_money", RANGE, options);
    tick(2000);
    run.completed({ rows: [1, 2, 3] });
    expect(sink.find("REPORT_SLOW")[0]).toMatchObject({ level: "WARN", duration_ms: 2000, metadata: { report: "time_and_money", recordCount: 3, thresholdMs: 2000 } });
    expect(sink.find("REPORT_GENERATION_COMPLETED")).toHaveLength(1);
  });

  it("writes FAILED at error with the error and its code, and marks the error as reported so the handler does not repeat it", () => {
    const { logger, sink, tick, options } = setup();
    const run = startReport(logger, "category_calendar", RANGE, options);
    tick(40);
    const failure = new Error("database is locked");
    run.failed(failure);
    const [failed] = sink.find("REPORT_GENERATION_FAILED");
    expect(failed).toMatchObject({ level: "ERROR", duration_ms: 40, error_code: "REPORT-001", error: { message: "database is locked" }, metadata: { report: "category_calendar" } });
    expect(isErrorReported(failure)).toBe(true);
    expect(sink.find("REPORT_GENERATION_COMPLETED")).toEqual([]);
  });

  it("says only one thing about a run, whichever way it is finished twice", () => {
    const { logger, sink, options } = setup();
    const run = startReport(logger, "time_and_money", RANGE, options);
    run.completed({});
    run.completed({});
    run.failed(new Error("late"));
    expect(sink.events().filter((event) => event !== "REPORT_GENERATION_STARTED")).toEqual(["REPORT_GENERATION_COMPLETED"]);
  });

  it("counts runs and times them by report, for the report-performance panel", () => {
    const { logger, tick, options } = setup();
    const completed = runs("metric_report", "completed");
    const failed = runs("metric_report", "failed");
    const measured = timed("metric_report");
    for (let i = 0; i < 2; i++) {
      const run = startReport(logger, "metric_report", RANGE, options);
      tick(10);
      run.completed({});
    }
    startReport(logger, "metric_report", RANGE, options).failed(new Error("x"));
    expect(runs("metric_report", "completed") - completed).toBe(2);
    expect(runs("metric_report", "failed") - failed).toBe(1);
    expect(timed("metric_report") - measured).toBe(3);
  });

  it("works without a period, and shows a date it cannot read as such rather than throwing", () => {
    const { logger, sink, options } = setup();
    startReport(logger, "no_range", null, options).completed({});
    expect(sink.find("REPORT_GENERATION_STARTED")[0].metadata.dateRange).toBeUndefined();
    startReport(logger, "bad_range", { from: new Date("nonsense"), to: "2026-09-22" }, options);
    expect(sink.find("REPORT_GENERATION_STARTED")[1].metadata.dateRange).toEqual({ from: "invalid", to: "2026-09-22" });
  });

  it("never lets a logging problem reach the report", () => {
    const { logger, options } = setup();
    const exploding = { debug: () => { throw new Error("log broke"); }, info: () => { throw new Error("log broke"); }, warn: () => { throw new Error("log broke"); }, error: () => { throw new Error("log broke"); } } as unknown as typeof logger;
    expect(() => startReport(exploding, "x", RANGE, options)).not.toThrow();
    const run = startReport(exploding, "x", RANGE, options);
    expect(() => run.completed({})).not.toThrow();
    expect(() => startReport(exploding, "x", RANGE, options).failed(new Error("e"))).not.toThrow();
  });
});
