import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryLogFileStore } from "./observability/core/logFileStore";
import { metrics } from "./observability/core/metrics";
import { getServerLogSinks, startServerLogSinks } from "./observability/server/serverSinks";
import { installMemoryLogger } from "./observability/testing";
import { purgeExpiredLogFiles, startLogRetentionJob } from "./logRetention";

let memory: ReturnType<typeof installMemoryLogger>;
const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

const runs = (outcome: string) => metrics.counter("jobs_total").value({ job: "log-retention", outcome });
const timed = () => metrics.histogram("job_duration_ms").entries().find((entry) => entry.labels === 'job="log-retention"')?.count ?? 0;

/** A server log folder holding archives of the given ages (in days), started with a clock fixed at NOW. */
function startWith(ages: number[], env: Record<string, string> = {}) {
  const store = new MemoryLogFileStore(() => NOW);
  ages.forEach((age, i) => {
    const d = new Date(NOW - age * DAY);
    const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}T120000000Z`;
    store.files.set(`parva-${stamp}${i ? `-${i}` : ""}.jsonl.gz`, { data: new Uint8Array(40), modifiedAt: NOW - age * DAY });
  });
  const sinks = startServerLogSinks({ core: memory.core, env: { LOG_FILE_DIR: "/logs", ...env }, store, now: () => NOW, onInternalProblem: () => {} });
  return { store, sinks };
}

beforeEach(() => {
  memory = installMemoryLogger();
});
afterEach(() => {
  getServerLogSinks()?.dispose();
  memory.restore();
  vi.useRealTimers();
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("parva.jobs.logRetention.v1")];
});

describe("purgeExpiredLogFiles", () => {
  it("does nothing, and says so, when the server keeps no log file", async () => {
    const before = runs("skipped");
    expect(await purgeExpiredLogFiles()).toBeNull();
    expect(memory.sink.find("JOB_SKIPPED")[0]).toMatchObject({ level: "DEBUG", metadata: { job: "log-retention" } });
    expect(runs("skipped") - before).toBe(1);
  });

  it("removes what is past the retention (14 days unless told otherwise), keeps the rest, and reports it", async () => {
    const { store } = startWith([40, 20, 15, 10, 2]);
    const completed = runs("completed");
    const measured = timed();
    expect(await purgeExpiredLogFiles()).toEqual({ removed: 3, retentionDays: 14 });
    expect([...store.files.keys()].length).toBe(2);
    expect(memory.sink.find("JOB_COMPLETED")[0]).toMatchObject({ level: "INFO", metadata: { job: "log-retention", deleted: 3, retentionDays: 14 } });
    expect(runs("completed") - completed).toBe(1);
    expect(timed() - measured).toBe(1);
  });

  it("follows LOG_RETENTION_DAYS", async () => {
    const { store } = startWith([40, 20, 10, 2], { LOG_RETENTION_DAYS: "7" });
    expect(await purgeExpiredLogFiles()).toEqual({ removed: 3, retentionDays: 7 });
    expect([...store.files.keys()].length).toBe(1);
  });

  it("keeps everything when retention is off (it is then bounded by the size ceiling only)", async () => {
    const { store } = startWith([400, 200, 10], { LOG_RETENTION_DAYS: "off" });
    expect(await purgeExpiredLogFiles()).toEqual({ removed: 0, retentionDays: null });
    expect(store.files.size).toBe(3);
  });

  it("is a quiet debug line when there was nothing to remove — a daily job must not fill the log", async () => {
    startWith([2, 1]);
    expect(await purgeExpiredLogFiles()).toEqual({ removed: 0, retentionDays: 14 });
    expect(memory.sink.find("JOB_COMPLETED")[0]).toMatchObject({ level: "DEBUG", metadata: { deleted: 0 } });
  });

  it("reports a failure as JOB_FAILED, counts it, and never throws", async () => {
    const { store } = startWith([40]);
    store.faults.always = { list: new Error("EIO: i/o error") };
    const failed = runs("failed");
    await expect(purgeExpiredLogFiles()).resolves.toBeNull();
    expect(memory.sink.find("JOB_FAILED")[0]).toMatchObject({ level: "ERROR", metadata: { job: "log-retention" } });
    expect(memory.sink.find("JOB_FAILED")[0].error?.message).toContain("EIO");
    expect(runs("failed") - failed).toBe(1);
  });
});

describe("startLogRetentionJob", () => {
  it("runs a few minutes after the start and then daily, and starting it twice does not double it", async () => {
    vi.useFakeTimers();
    const before = runs("skipped");
    startLogRetentionJob();
    startLogRetentionJob();
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    expect(runs("skipped") - before).toBe(0); // the first minutes belong to the first requests
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(runs("skipped") - before).toBe(1);
    await vi.advanceTimersByTimeAsync(DAY);
    expect(runs("skipped") - before).toBe(2);
  });
});
