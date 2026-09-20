import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ auditLog: { deleteMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { installMemoryLogger } from "./observability/testing";
import { DEFAULT_AUDIT_RETENTION_DAYS, auditRetentionDays, purgeExpiredAuditLogs, startAuditRetentionJob } from "./auditRetention";

let memory: ReturnType<typeof installMemoryLogger>;
const NOW = new Date("2026-09-20T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  memory = installMemoryLogger();
  prismaMock.auditLog.deleteMany.mockReset();
  prismaMock.auditLog.deleteMany.mockResolvedValue({ count: 0 });
  delete process.env.AUDIT_RETENTION_DAYS;
});
afterEach(() => {
  memory.restore();
  vi.useRealTimers();
  delete process.env.AUDIT_RETENTION_DAYS;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("parva.jobs.auditRetention.v1")];
});

describe("auditRetentionDays", () => {
  it("is two years unless told otherwise", () => {
    expect(DEFAULT_AUDIT_RETENTION_DAYS).toBe(730);
    expect(auditRetentionDays(undefined)).toBe(730);
    expect(auditRetentionDays("")).toBe(730);
    expect(auditRetentionDays("  ")).toBe(730);
  });

  it("reads a number of days", () => {
    expect(auditRetentionDays("365")).toBe(365);
    expect(auditRetentionDays(" 90 ")).toBe(90);
    expect(auditRetentionDays("30.9")).toBe(30);
  });

  it("means 'keep everything' for 0, off, never or forever", () => {
    for (const value of ["0", "off", "OFF", "never", "Forever"]) expect(auditRetentionDays(value), value).toBeNull();
  });

  it("falls back to the default for anything it cannot read, never to 'delete everything'", () => {
    for (const value of ["abc", "-5", "NaN", "1e999", "days"]) expect(auditRetentionDays(value), value).toBe(730);
  });

  it("reads the environment when not given a value", () => {
    process.env.AUDIT_RETENTION_DAYS = "400";
    expect(auditRetentionDays()).toBe(400);
  });
});

describe("purgeExpiredAuditLogs", () => {
  it("deletes only entries older than the cutoff, by date, and reports the count", async () => {
    prismaMock.auditLog.deleteMany.mockResolvedValue({ count: 12 });
    const result = await purgeExpiredAuditLogs(NOW, 730);
    expect(prismaMock.auditLog.deleteMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditLog.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: new Date(NOW.getTime() - 730 * DAY) } } });
    expect(result).toEqual({ deleted: 12, cutoff: new Date(NOW.getTime() - 730 * DAY), retentionDays: 730 });
    expect(memory.sink.find("JOB_COMPLETED")[0]).toMatchObject({ level: "INFO", metadata: { job: "audit-retention", deleted: 12, retentionDays: 730 } });
  });

  it("is only a DEBUG line when there was nothing to delete", async () => {
    await purgeExpiredAuditLogs(NOW, 730);
    expect(memory.sink.find("JOB_COMPLETED")[0].level).toBe("DEBUG");
  });

  it("does nothing when retention is off", async () => {
    expect(await purgeExpiredAuditLogs(NOW, null)).toBeNull();
    expect(prismaMock.auditLog.deleteMany).not.toHaveBeenCalled();
    expect(memory.sink.find("JOB_SKIPPED")).toHaveLength(1);
  });

  it("uses the configured retention when none is passed", async () => {
    process.env.AUDIT_RETENTION_DAYS = "100";
    await purgeExpiredAuditLogs(NOW);
    expect(prismaMock.auditLog.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: new Date(NOW.getTime() - 100 * DAY) } } });
  });

  it("never throws: a failing database is reported as a failed job", async () => {
    prismaMock.auditLog.deleteMany.mockRejectedValue(new Error("connection refused"));
    await expect(purgeExpiredAuditLogs(NOW, 730)).resolves.toBeNull();
    expect(memory.sink.find("JOB_FAILED")[0]).toMatchObject({ level: "ERROR", metadata: { job: "audit-retention" } });
  });
});

describe("startAuditRetentionJob", () => {
  it("runs once a few minutes after start and then daily, and starting twice does not double it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    startAuditRetentionJob();
    startAuditRetentionJob();
    expect(prismaMock.auditLog.deleteMany).not.toHaveBeenCalled(); // not at boot

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 10);
    expect(prismaMock.auditLog.deleteMany).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DAY);
    expect(prismaMock.auditLog.deleteMany).toHaveBeenCalledTimes(2);
  });
});
