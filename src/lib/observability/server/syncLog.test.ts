import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SYNC_TABLES } from "@/lib/syncTables";
import { installMemoryLogger } from "../testing";
import { categorizeRejection, logSyncPull, logSyncPush, summarizePush } from "./syncLog";

let memory: ReturnType<typeof installMemoryLogger>;
beforeEach(() => {
  memory = installMemoryLogger();
});
afterEach(() => memory.restore());

describe("categorizeRejection", () => {
  it("keeps the field and the kind of failure, and drops the value that failed", () => {
    expect(categorizeRejection('amount: not a number ("abc")')).toBe("amount: not a number");
    expect(categorizeRejection('dueDate: not a valid date ("همین دیروز")')).toBe("dueDate: not a valid date");
    expect(categorizeRejection('isDone: not a boolean ("maybe")')).toBe("isDone: not a boolean");
    expect(categorizeRejection('count: not an integer (1.5)')).toBe("count: not an integer");
    expect(categorizeRejection("title: required value is missing")).toBe("title: required value is missing");
    expect(categorizeRejection("amount: 3000000000 is larger than the server allows (max 2147483647)")).toBe("amount: value is larger than the server allows");
  });

  it("recognises the row-level refusals and reduces everything else to 'other'", () => {
    expect(categorizeRejection("missing id")).toBe("missing id");
    expect(categorizeRejection("parent row not found for this account")).toBe("parent row not found for this account");
    expect(categorizeRejection("id belongs to a different account")).toBe("id belongs to a different account");
    expect(categorizeRejection("missing parent row (foreign key habitId)")).toBe("missing parent row");
    expect(categorizeRejection('duplicate of an existing row (unique ["habitId","date"])')).toBe("duplicate of an existing row");
    expect(categorizeRejection("Argument `data.title` is a very long sentence that might quote something private")).toBe("other");
    expect(categorizeRejection(undefined as unknown as string)).toBe("other");
  });
});

describe("summarizePush", () => {
  it("adds up per table and lists refusals by category, with the unlisted remainder counted", () => {
    const summary = summarizePush({
      Task: { upserted: 5, skipped: 1, rejected: 0 },
      Transaction: {
        upserted: 2,
        skipped: 0,
        rejected: 4,
        rejectedRows: [
          { id: "t1", reason: 'amount: not a number ("x")' },
          { id: "t2", reason: 'amount: not a number ("y")' },
          { id: "t3", reason: "parent row not found for this account" },
        ],
      },
    });
    expect(summary.totals).toEqual({ upserted: 7, skipped: 1, rejected: 4 });
    expect(summary.tables.Task).toEqual({ upserted: 5, skipped: 1, rejected: 0 });
    expect(summary.rejections).toEqual({
      "Transaction: amount: not a number": 2,
      "Transaction: parent row not found for this account": 1,
      "Transaction: unlisted": 1,
    });
  });

  it("caps how many distinct groups it names", () => {
    const rejectedRows = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, reason: `field${i}: not a number ("v")` }));
    const summary = summarizePush({ Task: { upserted: 0, skipped: 0, rejected: 30, rejectedRows } });
    expect(Object.keys(summary.rejections).length).toBeLessThanOrEqual(21);
  });
});

describe("logSyncPush", () => {
  it("is a DEBUG line when nothing changed — an idempotent re-send", () => {
    logSyncPush({ Task: { upserted: 0, skipped: 3, rejected: 0 } }, { applied: 0, ignored: 0 }, false);
    expect(memory.sink.find("SYNC_PUSH_SUCCESS")[0]).toMatchObject({ level: "DEBUG", module: "sync", metadata: { direction: "push", counts: { upserted: 0, skipped: 3, rejected: 0 } } });
  });

  it("is an INFO line when rows were written, or a deletion or profile applied", () => {
    logSyncPush({ Task: { upserted: 2, skipped: 0, rejected: 0 } }, { applied: 0, ignored: 0 }, false);
    logSyncPush({}, { applied: 1, ignored: 0 }, false);
    logSyncPush({}, { applied: 0, ignored: 0 }, true);
    expect(memory.sink.find("SYNC_PUSH_SUCCESS").map((r) => r.level)).toEqual(["INFO", "INFO", "INFO"]);
  });

  it("is a WARN partial success, naming the reasons, when the server refused rows", () => {
    logSyncPush(
      { Transaction: { upserted: 1, skipped: 0, rejected: 1, rejectedRows: [{ id: "t9", reason: 'amount: not a number ("۱۲۳ تومان محرمانه")' }] } },
      { applied: 0, ignored: 0 },
      false
    );
    const [record] = memory.sink.find("SYNC_PARTIAL_SUCCESS");
    expect(record).toMatchObject({ level: "WARN", metadata: { counts: { upserted: 1, rejected: 1 }, rejections: { "Transaction: amount: not a number": 1 } } });
    expect(JSON.stringify(record)).not.toContain("محرمانه");
    expect(JSON.stringify(record)).not.toContain("t9");
  });

  it("never lets a table name be swallowed by the redactor, whichever table it is", () => {
    const results = Object.fromEntries(SYNC_TABLES.map((config) => [config.table, { upserted: 1, skipped: 0, rejected: 0 }]));
    logSyncPush(results, { applied: 0, ignored: 0 }, false);
    const tables = memory.sink.find("SYNC_PUSH_SUCCESS")[0].metadata.tables as Record<string, unknown>;
    for (const config of SYNC_TABLES) expect(tables[config.table], config.table).toEqual({ upserted: 1, skipped: 0, rejected: 0 });
  });

  it("does not throw on a malformed result", () => {
    expect(() => logSyncPush(null as never, { applied: 0, ignored: 0 }, false)).not.toThrow();
    expect(() => logSyncPush({ Task: undefined } as never, { applied: 0, ignored: 0 }, false)).not.toThrow();
  });
});

describe("logSyncPull", () => {
  it("counts rows per table and is INFO only when something was sent", () => {
    logSyncPull({ Task: [{}, {}], Habit: [], Project: [{}] }, 1, true);
    logSyncPull({ Task: [] }, 0, true);
    const [sent, idle] = memory.sink.find("SYNC_PULL_SUCCESS");
    expect(sent).toMatchObject({ level: "INFO", metadata: { direction: "pull", rows: 3, tables: { Task: 2, Project: 1 }, tombstones: 1, incremental: true } });
    expect(idle).toMatchObject({ level: "DEBUG", metadata: { rows: 0, tables: {}, incremental: true } });
  });

  it("does not throw on odd input", () => {
    expect(() => logSyncPull(null as never, 0, false)).not.toThrow();
  });
});
