// The phone's transaction wrapper against a real SQLite (sql.js) database: what commits together, what rolls
// back together, which work waits for the commit, and what the log says. (The routes that use it are tested in
// atomicOperations.test.ts.)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/apiErrorBase";
import { isErrorReported } from "@/lib/observability";
import { installMemoryLogger } from "@/lib/observability/testing";
import { writeLocalAuditLog } from "./audit";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "./db";
import { createNodeSqliteDriver } from "./drivers/nodeSqlite";
import { getLocalUserId } from "./localUser";
import { afterLocalCommit, inLocalTransaction, withLocalTransaction } from "./transaction";

let db: LocalDb;
let userId: string;
let memory: ReturnType<typeof installMemoryLogger>;

beforeEach(async () => {
  resetLocalDbForTests();
  db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  userId = getLocalUserId(db);
  memory = installMemoryLogger();
});
afterEach(() => memory.restore());

let counter = 0;
const stamp = () => new Date().toISOString();
function addTask(title: string): string {
  const id = `task-${++counter}`;
  db.run(`INSERT INTO "Task" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, [id, userId, title, stamp(), stamp()]);
  return id;
}
const titled = (title: string) => db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "Task" WHERE "title" = ?`, [title])!.n;

/** The same database, except that one statement is refused — for the failures SQLite itself does not produce on demand. */
function refusing(statement: string, message: string): LocalDb {
  return {
    run: (sql, params) => db.run(sql, params),
    get: (sql, params) => db.get(sql, params),
    all: (sql, params) => db.all(sql, params),
    execute(sql) {
      if (sql === statement) throw new Error(message);
      db.execute(sql);
    },
  } as LocalDb;
}

describe("withLocalTransaction", () => {
  it("commits everything the callback wrote, and returns what it returned", () => {
    const result = withLocalTransaction(db, () => {
      addTask("commit-a");
      addTask("commit-b");
      return "done";
    });
    expect(result).toBe("done");
    expect(titled("commit-a")).toBe(1);
    expect(titled("commit-b")).toBe(1);
  });

  it("rolls everything back when the callback throws, and rethrows the very same error", () => {
    const failure = new Error("boom");
    expect(() =>
      withLocalTransaction(db, () => {
        addTask("rollback");
        throw failure;
      })
    ).toThrow(failure);
    expect(titled("rollback")).toBe(0);
  });

  it("can be used again straight after a failure — nothing is left open", () => {
    expect(() =>
      withLocalTransaction(db, () => {
        addTask("first");
        throw new Error("x");
      })
    ).toThrow();
    expect(inLocalTransaction(db)).toBe(false);
    withLocalTransaction(db, () => addTask("second"));
    expect(titled("first")).toBe(0);
    expect(titled("second")).toBe(1);
  });

  it("joins a transaction that is already open: the outer one decides, and only it is logged", () => {
    memory.sink.clear();
    expect(() =>
      withLocalTransaction(db, () => {
        addTask("outer");
        withLocalTransaction(db, () => addTask("inner"), { operation: "TASK_CREATE" }); // no BEGIN inside a BEGIN
        throw new Error("the outer step failed after the inner one succeeded");
      })
    ).toThrow("outer step failed");
    expect(titled("inner")).toBe(0); // the inner "success" was never committed on its own
    expect(titled("outer")).toBe(0);
    expect(memory.sink.find("DB_TRANSACTION_ROLLBACK")).toHaveLength(1);
    expect(memory.sink.find("DB_TRANSACTION_COMMIT")).toHaveLength(0);
    expect(memory.sink.find("TASK_CREATE_FAILED")).toEqual([]); // the inner one is not a transaction of its own
  });

  it("knows when it is inside one", () => {
    expect(inLocalTransaction(db)).toBe(false);
    withLocalTransaction(db, () => {
      expect(inLocalTransaction(db)).toBe(true);
    });
    expect(inLocalTransaction(db)).toBe(false);
  });

  it("refuses an async callback — a transaction must not stay open across an await — and rolls it back", () => {
    expect(() =>
      withLocalTransaction(db, async () => {
        addTask("async"); // runs synchronously, up to the first await
        await Promise.resolve();
      })
    ).toThrow(/async/);
    expect(titled("async")).toBe(0);
    expect(inLocalTransaction(db)).toBe(false);
  });
});

describe("work that waits for the commit", () => {
  it("runs after the commit, in order", () => {
    const order: string[] = [];
    withLocalTransaction(db, () => {
      afterLocalCommit(db, () => order.push("first"));
      afterLocalCommit(db, () => order.push("second"));
      order.push("body");
    });
    expect(order).toEqual(["body", "first", "second"]);
  });

  it("never runs when the transaction rolls back", () => {
    const ran = vi.fn();
    expect(() =>
      withLocalTransaction(db, () => {
        afterLocalCommit(db, ran);
        throw new Error("nope");
      })
    ).toThrow("nope");
    expect(ran).not.toHaveBeenCalled();
  });

  it("runs at once when there is no transaction to wait for", () => {
    const ran = vi.fn();
    afterLocalCommit(db, ran);
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it("does not let a failing hook fail the operation it follows, and says so", () => {
    const later = vi.fn();
    const result = withLocalTransaction(db, () => {
      afterLocalCommit(db, () => {
        throw new Error("hook failed");
      });
      afterLocalCommit(db, later);
      return 42;
    });
    expect(result).toBe(42);
    expect(later).toHaveBeenCalled(); // the hooks after it still ran
    expect(memory.sink.find("SYSTEM_UNHANDLED_ERROR")[0]).toMatchObject({ level: "ERROR", layer: "local", metadata: { kind: "after-commit hook" } });
  });

  it("holds the history entry's success line back until the commit — the entry itself is stored with the change, and goes with it on rollback", () => {
    const auditRows = (entityId: string) => db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "AuditLog" WHERE "entityId" = ?`, [entityId])!.n;
    memory.sink.clear();

    let rowsInside = -1;
    let successInside = -1;
    withLocalTransaction(db, () => {
      writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "Task", entityId: "kept", newValue: { id: "kept", title: "x" } });
      rowsInside = auditRows("kept");
      successInside = memory.sink.find("TASK_CREATE_SUCCESS").length;
    });
    expect(rowsInside).toBe(1); // part of the transaction
    expect(successInside).toBe(0); // …but not yet reported as a success
    expect(auditRows("kept")).toBe(1);
    const order = memory.sink.events();
    expect(order.indexOf("DB_TRANSACTION_COMMIT")).toBeLessThan(order.indexOf("TASK_CREATE_SUCCESS"));
    expect(memory.sink.find("TASK_CREATE_SUCCESS")[0]).toMatchObject({ level: "INFO", layer: "local", entity_id: "kept" });

    memory.sink.clear();
    expect(() =>
      withLocalTransaction(db, () => {
        writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "Task", entityId: "lost", newValue: { id: "lost", title: "y" } });
        throw new Error("rolled back");
      })
    ).toThrow();
    expect(auditRows("lost")).toBe(0);
    expect(memory.sink.find("TASK_CREATE_SUCCESS")).toEqual([]);
  });
});

describe("what the log says", () => {
  it("a commit is a DEBUG line with the operation and how long it took", () => {
    withLocalTransaction(db, () => undefined, { operation: "TASK_CREATE" });
    expect(memory.sink.find("DB_TRANSACTION_COMMIT")[0]).toMatchObject({ level: "DEBUG", operation: "TASK_CREATE", layer: "local" });
    expect(typeof memory.sink.find("DB_TRANSACTION_COMMIT")[0].duration_ms).toBe("number");
    expect(memory.sink.find("TASK_CREATE_FAILED")).toEqual([]);
  });

  it("an unexpected failure is a WARN rollback and an ERROR <OPERATION>_FAILED with the stack, and is marked as reported", () => {
    const failure = new Error("the second write failed");
    expect(() =>
      withLocalTransaction(
        db,
        () => {
          addTask("unexpected");
          throw failure;
        },
        { operation: "TASK_CREATE", entityType: "Task", entityId: "t-1" }
      )
    ).toThrow(failure);

    expect(titled("unexpected")).toBe(0);
    expect(memory.sink.find("DB_TRANSACTION_ROLLBACK")[0]).toMatchObject({ level: "WARN", operation: "TASK_CREATE", error_code: "SYS-001", layer: "local" });
    const failed = memory.sink.find("TASK_CREATE_FAILED")[0];
    expect(failed).toMatchObject({ level: "ERROR", entity_type: "Task", entity_id: "t-1", error_code: "SYS-001", layer: "local", error: { type: "Error" } });
    expect(failed.error?.stack).toContain("Error:");
    expect(isErrorReported(failure)).toBe(true); // the dispatcher will not write it again as API_UNHANDLED_ERROR
  });

  it("a caller's own mistake rolls back quietly: WARN <OPERATION>_FAILED, a DEBUG rollback, no ERROR, still the dispatcher's to answer", () => {
    const refusal = new ApiError("این قسط قبلاً پرداخت شده است.", 409);
    expect(() =>
      withLocalTransaction(
        db,
        () => {
          addTask("expected");
          throw refusal;
        },
        { operation: "INSTALLMENT_PAY", entityType: "Installment" }
      )
    ).toThrow(refusal);
    expect(titled("expected")).toBe(0);
    expect(memory.sink.find("DB_TRANSACTION_ROLLBACK")[0]).toMatchObject({ level: "DEBUG" });
    expect(memory.sink.find("DB_TRANSACTION_ROLLBACK")[0].error_code).toBeUndefined(); // a 409 has no generic code, and none is invented
    expect(memory.sink.find("INSTALLMENT_PAY_FAILED")[0]).toMatchObject({ level: "WARN", entity_type: "Installment" });
    expect(memory.sink.records.filter((record) => record.level === "ERROR")).toEqual([]);
    expect(isErrorReported(refusal)).toBe(false);
  });

  it("without an operation there is only the rollback line", () => {
    expect(() =>
      withLocalTransaction(db, () => {
        throw new Error("x");
      })
    ).toThrow("x");
    expect(memory.sink.find("DB_TRANSACTION_ROLLBACK")).toHaveLength(1);
    expect(memory.sink.records.some((record) => record.event.endsWith("_FAILED"))).toBe(false);
  });
});

describe("when the database itself refuses", () => {
  it("a commit that fails is DB_TRANSACTION_FAILED with the transaction code — and the work is rolled back", () => {
    const flaky = refusing("COMMIT", "disk I/O error");
    expect(() =>
      withLocalTransaction(
        flaky,
        () => {
          addTask("uncommitted");
        },
        { operation: "TASK_CREATE" }
      )
    ).toThrow("disk I/O error");

    expect(titled("uncommitted")).toBe(0);
    expect(inLocalTransaction(flaky)).toBe(false);
    expect(memory.sink.find("DB_TRANSACTION_FAILED")[0]).toMatchObject({ level: "ERROR", error_code: "DB-003", operation: "TASK_CREATE", layer: "local" });
    expect(memory.sink.find("DB_TRANSACTION_ROLLBACK")).toEqual([]);
    expect(memory.sink.find("TASK_CREATE_FAILED")[0]).toMatchObject({ level: "ERROR", error_code: "DB-003" });
    // and the database is usable afterwards: no transaction was left open behind it
    withLocalTransaction(db, () => addTask("after"));
    expect(titled("after")).toBe(1);
  });

  it("a BEGIN that fails is DB_TRANSACTION_FAILED, and nothing runs", () => {
    const flaky = refusing("BEGIN", "database is locked");
    const body = vi.fn();
    expect(() => withLocalTransaction(flaky, body)).toThrow("database is locked");
    expect(body).not.toHaveBeenCalled();
    expect(inLocalTransaction(flaky)).toBe(false);
    expect(memory.sink.find("DB_TRANSACTION_FAILED")[0]).toMatchObject({ level: "ERROR", error_code: "DB-003" });
  });

  it("a transaction SQLite already rolled back by itself is not a second failure: the callback's own error is what surfaces", () => {
    const failure = new Error("the write failed");
    expect(() =>
      withLocalTransaction(db, () => {
        addTask("undone");
        db.execute("ROLLBACK"); // what SQLite does to the transaction after, say, a full disk
        throw failure;
      })
    ).toThrow(failure);
    expect(titled("undone")).toBe(0);
    expect(memory.sink.find("DB_TRANSACTION_FAILED")).toEqual([]);
    withLocalTransaction(db, () => addTask("still works"));
    expect(titled("still works")).toBe(1);
  });
});
