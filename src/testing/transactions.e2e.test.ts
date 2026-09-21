// The transaction primitive against a real database: what commits together, what rolls back together,
// which work waits for the commit, and what the log says. (The routes that use it are tested in
// atomicOperations.e2e.test.ts.)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const { cookieJar } = await import("@/testing/cookieJar");
  return { cookies: () => cookieJar };
});

import { metrics } from "@/lib/observability/core/metrics";
import { installMemoryLogger } from "@/lib/observability/testing";
import { isErrorReported } from "@/lib/observability/server/transactionContext";
import { createServerHarness, type ServerHarness } from "@/testing/syncHarness";

vi.setConfig({ testTimeout: 60_000 });

let server: ServerHarness;
let memory: ReturnType<typeof installMemoryLogger>;
let userId: string;

beforeAll(async () => {
  server = await createServerHarness();
  userId = (await server.registerUser()).userId;
}, 120_000);
afterAll(async () => {
  await server.dispose();
});
beforeEach(() => {
  memory = installMemoryLogger();
});
afterEach(() => {
  memory.restore();
});

/** The library under test, loaded after the harness has pointed the database at its scratch file. */
async function lib() {
  const [{ withTransaction, afterCommit, inTransaction }, { prisma }, { writeAuditLog }, { ApiError, handleApiError }] = await Promise.all([
    import("@/lib/transaction"),
    import("@/lib/db"),
    import("@/lib/audit"),
    import("@/lib/apiError"),
  ]);
  return { withTransaction, afterCommit, inTransaction, prisma, writeAuditLog, ApiError, handleApiError };
}

const unique = () => Math.random().toString(36).slice(2, 10);
const titled = (title: string) => server.prisma.task.count({ where: { userId, title } });

describe("withTransaction", () => {
  it("commits everything the callback wrote, and returns what it returned", async () => {
    const { withTransaction, prisma } = await lib();
    const a = `commit-a-${unique()}`;
    const b = `commit-b-${unique()}`;
    const result = await withTransaction(async () => {
      await prisma.task.create({ data: { userId, title: a } });
      await prisma.task.create({ data: { userId, title: b } });
      return "done";
    });
    expect(result).toBe("done");
    expect(await titled(a)).toBe(1);
    expect(await titled(b)).toBe(1);
  });

  it("rolls everything back when the callback throws, and rethrows the very same error", async () => {
    const { withTransaction, prisma } = await lib();
    const title = `rollback-${unique()}`;
    const failure = new Error("boom");
    await expect(
      withTransaction(async () => {
        await prisma.task.create({ data: { userId, title } });
        throw failure;
      })
    ).rejects.toBe(failure);
    expect(await titled(title)).toBe(0);
  });

  it("takes in the writes of a helper that knows nothing about transactions — it just uses prisma", async () => {
    const { withTransaction, prisma } = await lib();
    async function createPlainly(title: string) {
      return prisma.task.create({ data: { userId, title } }); // no transaction handed to it
    }
    const kept = `helper-kept-${unique()}`;
    const lost = `helper-lost-${unique()}`;
    await withTransaction(async () => {
      await createPlainly(kept);
    });
    await expect(
      withTransaction(async () => {
        await createPlainly(lost);
        throw new Error("later step failed");
      })
    ).rejects.toThrow("later step failed");
    expect(await titled(kept)).toBe(1);
    expect(await titled(lost)).toBe(0);
  });

  it("can see its own uncommitted writes", async () => {
    const { withTransaction, prisma } = await lib();
    const title = `visible-${unique()}`;
    const seen = await withTransaction(async () => {
      await prisma.task.create({ data: { userId, title } });
      return prisma.task.count({ where: { userId, title } });
    });
    expect(seen).toBe(1);
  });

  it("keeps concurrent transactions apart: one fails, the other is untouched", async () => {
    const { withTransaction, prisma } = await lib();
    const good = `concurrent-good-${unique()}`;
    const bad = `concurrent-bad-${unique()}`;
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const results = await Promise.allSettled([
      withTransaction(async () => {
        await prisma.task.create({ data: { userId, title: good } });
        await pause(20);
        return "ok";
      }),
      withTransaction(async () => {
        await prisma.task.create({ data: { userId, title: bad } });
        await pause(5);
        throw new Error("only this one fails");
      }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(await titled(good)).toBe(1);
    expect(await titled(bad)).toBe(0);
  });

  it("joins a transaction that is already open: the outer one decides, and only it is logged", async () => {
    const { withTransaction, prisma } = await lib();
    const inner = `nested-inner-${unique()}`;
    const outer = `nested-outer-${unique()}`;
    memory.sink.clear();
    await expect(
      withTransaction(async () => {
        await prisma.task.create({ data: { userId, title: outer } });
        await withTransaction(async () => {
          await prisma.task.create({ data: { userId, title: inner } });
        });
        throw new Error("the outer step failed after the inner one succeeded");
      })
    ).rejects.toThrow("outer step failed");
    expect(await titled(inner)).toBe(0); // the inner "success" was never committed on its own
    expect(await titled(outer)).toBe(0);
    expect(memory.sink.find("DB_TRANSACTION_ROLLBACK")).toHaveLength(1);
    expect(memory.sink.find("DB_TRANSACTION_COMMIT")).toHaveLength(0);
  });

  it("knows when it is inside one", async () => {
    const { withTransaction, inTransaction } = await lib();
    expect(inTransaction()).toBe(false);
    await withTransaction(async () => {
      expect(inTransaction()).toBe(true);
    });
    expect(inTransaction()).toBe(false);
  });
});

describe("work that waits for the commit", () => {
  it("runs after the commit, in order, when the rows are already visible to everyone else", async () => {
    const { withTransaction, afterCommit, prisma } = await lib();
    const title = `hook-${unique()}`;
    const order: string[] = [];
    let visibleFromHook = -1;
    await withTransaction(async () => {
      await prisma.task.create({ data: { userId, title } });
      afterCommit(async () => {
        order.push("first");
        visibleFromHook = await titled(title); // outside the transaction now: it must be committed
      });
      afterCommit(() => {
        order.push("second");
      });
      order.push("body");
    });
    expect(order).toEqual(["body", "first", "second"]);
    expect(visibleFromHook).toBe(1);
  });

  it("never runs when the transaction rolls back", async () => {
    const { withTransaction, afterCommit } = await lib();
    const ran = vi.fn();
    await expect(
      withTransaction(async () => {
        afterCommit(ran);
        throw new Error("nope");
      })
    ).rejects.toThrow("nope");
    expect(ran).not.toHaveBeenCalled();
  });

  it("runs at once when there is no transaction to wait for", async () => {
    const { afterCommit } = await lib();
    const ran = vi.fn();
    afterCommit(ran);
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it("does not let a failing hook fail the operation it follows, and says so", async () => {
    const { withTransaction, afterCommit } = await lib();
    const later = vi.fn();
    const result = await withTransaction(async () => {
      afterCommit(() => {
        throw new Error("hook failed");
      });
      afterCommit(later);
      return 42;
    });
    expect(result).toBe(42);
    expect(later).toHaveBeenCalled(); // the hooks after it still ran
    expect(memory.sink.find("SYSTEM_UNHANDLED_ERROR")[0]).toMatchObject({ level: "ERROR", metadata: { kind: "after-commit hook" } });
  });

  it("holds the history entry and the success line back until the commit — and never writes them for a rollback", async () => {
    const { withTransaction, writeAuditLog } = await lib();
    const entityId = `hold-${unique()}`;
    const params = { userId, action: "CREATE", entityType: "Task", entityId, newValue: { id: entityId, title: "x" } };
    memory.sink.clear();

    let rowsInside = -1;
    let successInside = -1;
    await withTransaction(async () => {
      await writeAuditLog(params);
      rowsInside = await server.prisma.auditLog.count({ where: { entityId } });
      successInside = memory.sink.find("TASK_CREATE_SUCCESS").length;
    });
    expect(rowsInside).toBe(0); // not yet
    expect(successInside).toBe(0);
    expect(await server.prisma.auditLog.count({ where: { entityId } })).toBe(1); // written once it committed
    expect(memory.sink.find("TASK_CREATE_SUCCESS")).toHaveLength(1);

    memory.sink.clear();
    const lost = `hold-lost-${unique()}`;
    await expect(
      withTransaction(async () => {
        await writeAuditLog({ ...params, entityId: lost });
        throw new Error("rolled back");
      })
    ).rejects.toThrow();
    expect(await server.prisma.auditLog.count({ where: { entityId: lost } })).toBe(0);
    expect(memory.sink.find("TASK_CREATE_SUCCESS")).toEqual([]);
  });
});

describe("what the log says", () => {
  it("a commit is a DEBUG line with the operation and how long it took", async () => {
    const { withTransaction } = await lib();
    await withTransaction(async () => undefined, { operation: "TASK_CREATE" });
    expect(memory.sink.find("DB_TRANSACTION_COMMIT")[0]).toMatchObject({ level: "DEBUG", operation: "TASK_CREATE" });
    expect(typeof memory.sink.find("DB_TRANSACTION_COMMIT")[0].duration_ms).toBe("number");
    expect(memory.sink.find("TASK_CREATE_FAILED")).toEqual([]);
  });

  it("an unexpected failure is a WARN rollback and an ERROR <OPERATION>_FAILED with the stack, written once", async () => {
    const { withTransaction, prisma, handleApiError } = await lib();
    const title = `unexpected-${unique()}`;
    const failure = new Error("the second write failed");
    await expect(
      withTransaction(
        async () => {
          await prisma.task.create({ data: { userId, title } });
          throw failure;
        },
        { operation: "TASK_CREATE", entityType: "Task", entityId: "t-1" }
      )
    ).rejects.toBe(failure);

    expect(memory.sink.find("DB_TRANSACTION_ROLLBACK")[0]).toMatchObject({ level: "WARN", operation: "TASK_CREATE", error_code: "SYS-001" });
    const failed = memory.sink.find("TASK_CREATE_FAILED")[0];
    expect(failed).toMatchObject({ level: "ERROR", entity_type: "Task", entity_id: "t-1", error_code: "SYS-001", error: { type: "Error" } });
    expect(failed.error?.stack).toContain("Error:");
    expect(isErrorReported(failure)).toBe(true);

    // The API layer knows it was written and does not write it again — but still answers 500 with the code.
    memory.sink.clear();
    const response = handleApiError(failure);
    expect(response.status).toBe(500);
    expect(memory.sink.find("API_UNHANDLED_ERROR")).toEqual([]);
  });

  it("a caller's own mistake rolls back quietly: WARN <OPERATION>_FAILED, a DEBUG rollback, no ERROR, still the API layer's to report", async () => {
    const { withTransaction, prisma, ApiError } = await lib();
    const title = `expected-${unique()}`;
    const refusal = new ApiError("این قسط قبلاً پرداخت شده است.", 409);
    await expect(
      withTransaction(
        async () => {
          await prisma.task.create({ data: { userId, title } });
          throw refusal;
        },
        { operation: "INSTALLMENT_PAY", entityType: "Installment" }
      )
    ).rejects.toBe(refusal);
    expect(await titled(title)).toBe(0);
    expect(memory.sink.find("DB_TRANSACTION_ROLLBACK")[0]).toMatchObject({ level: "DEBUG" });
    expect(memory.sink.find("DB_TRANSACTION_ROLLBACK")[0].error_code).toBeUndefined(); // a 409 has no generic code, and none is invented
    expect(memory.sink.find("INSTALLMENT_PAY_FAILED")[0]).toMatchObject({ level: "WARN", entity_type: "Installment" });
    expect(memory.sink.records.filter((record) => record.level === "ERROR")).toEqual([]);
    expect(isErrorReported(refusal)).toBe(false);
  });

  it("without an operation there is only the rollback line", async () => {
    const { withTransaction } = await lib();
    await expect(withTransaction(async () => Promise.reject(new Error("x")))).rejects.toThrow();
    expect(memory.sink.find("DB_TRANSACTION_ROLLBACK")).toHaveLength(1);
    expect(memory.sink.records.some((record) => record.event.endsWith("_FAILED"))).toBe(false);
  });

  it("a transaction that times out is DB_TRANSACTION_FAILED with the transaction code, not a rollback", async () => {
    const { withTransaction, prisma } = await lib();
    const failure = await withTransaction(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        await prisma.task.count({ where: { userId } });
      },
      { timeoutMs: 50, operation: "TASK_CREATE" }
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(memory.sink.find("DB_TRANSACTION_FAILED")[0]).toMatchObject({ level: "ERROR", error_code: "DB-003" });
    expect(memory.sink.find("DB_TRANSACTION_ROLLBACK")).toEqual([]);
    expect(memory.sink.find("TASK_CREATE_FAILED")[0]).toMatchObject({ level: "ERROR", error_code: "DB-003" });
  });

  it("counts commits and rollbacks for /metrics", async () => {
    const { withTransaction } = await lib();
    const commits = metrics.counter("db_transactions_total").value({ outcome: "commit" });
    const rollbacks = metrics.counter("db_transactions_total").value({ outcome: "rollback" });
    await withTransaction(async () => undefined);
    await withTransaction(async () => Promise.reject(new Error("x"))).catch(() => undefined);
    expect(metrics.counter("db_transactions_total").value({ outcome: "commit" })).toBe(commits + 1);
    expect(metrics.counter("db_transactions_total").value({ outcome: "rollback" })).toBe(rollbacks + 1);
  });

  it("the database work of a transaction is still counted against the request", async () => {
    const { withTransaction, prisma } = await lib();
    const { beginRequest, runWithRequestContext } = await import("@/lib/observability/server/requestContext");
    const context = beginRequest(new Request("http://localhost/api/x"), "POST", "/api/x");
    await runWithRequestContext(context, () =>
      withTransaction(async () => {
        await prisma.task.count({ where: { userId } });
        await prisma.task.count({ where: { userId } });
      })
    );
    expect(context.db.queries).toBeGreaterThanOrEqual(2);
  });
});
