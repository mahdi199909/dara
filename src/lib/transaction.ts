// Real database transactions for operations that write more than one row.
//
//   const task = await withTransaction(
//     async () => {
//       const created = await prisma.task.create({ … });
//       await syncTaskDirectCostTransaction(created.id);   // its writes join the same transaction
//       return prisma.task.findUniqueOrThrow({ … });
//     },
//     { operation: "TASK_CREATE", entityType: "Task" }
//   );
//   await writeAuditLog({ … });                            // only reached once everything committed
//
// Everything the callback writes, through `prisma` or through any helper that uses it, commits together
// or not at all. What the log then says can be trusted:
//   - commit    → DB_TRANSACTION_COMMIT (DEBUG); work queued with afterCommit() runs — the history entry
//                 and the *_SUCCESS line are exactly that, so "success" is never logged for something
//                 that was not committed;
//   - rollback  → DB_TRANSACTION_ROLLBACK, and <OPERATION>_FAILED when an operation was named
//                 (TASK_CREATE_FAILED …); queued work is discarded; the error is rethrown unchanged;
//   - the transaction itself failed (timeout, lost connection, a failed commit) → DB_TRANSACTION_FAILED.
// A callback that fails because of the caller's own mistake (a 404, a 409, invalid input) rolls back too,
// but is a WARN/DEBUG, not an ERROR — it is the expected outcome, and the request record says so as well.
//
// Called inside another withTransaction, it simply joins it: the outermost one owns commit and rollback.
import { rawPrisma } from "./db";
import { getLogger, markErrorReported, metrics, type ErrorCode, type EventName, type OperationBase } from "./observability";
import { getTransactionStore, runInTransactionStore, type TransactionStore } from "./observability/server/transactionContext";
import { failureCode, isExpectedFailure } from "./transactionFailure";

export { afterCommit, inTransaction } from "./observability/server/transactionContext";

// No fixed module: DB_TRANSACTION_* belong to the database, TASK_CREATE_FAILED to tasks.
const log = getLogger(null, "transaction");

const outcomes = metrics.counter("db_transactions_total", "Database transactions, by outcome (commit, rollback, failed).");
const durations = metrics.histogram("db_transaction_duration_ms", "Database transaction duration in milliseconds.");

/** How long to wait for a connection, and how long the callback may run, before the transaction is abandoned. */
const DEFAULT_MAX_WAIT_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15_000;

export interface TransactionOptions {
  /** The operation this transaction is part of; on rollback its <OPERATION>_FAILED event is written. */
  operation?: OperationBase;
  entityType?: string;
  entityId?: string;
  timeoutMs?: number;
  maxWaitMs?: number;
}

const NO_ERROR = Symbol("no error");

/** Prisma's own "Transaction API error": the transaction timed out, or was already closed. */
function isTransactionApiError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2028";
}

function report(error: unknown, bodyError: unknown, durationMs: number, options: TransactionOptions): void {
  const fromCallback = bodyError !== NO_ERROR;
  const thrown = fromCallback ? bodyError : error;
  // Not the callback's own failure: the timeout, the lost connection, the failed COMMIT.
  const machinery = !fromCallback || isTransactionApiError(thrown);
  const expected = !machinery && isExpectedFailure(thrown);
  const errorCode: ErrorCode | undefined = machinery ? "DB-003" : failureCode(thrown);

  outcomes.inc({ outcome: machinery ? "failed" : "rollback" });
  durations.observe(durationMs, { outcome: machinery ? "failed" : "rollback" });

  if (machinery) {
    log.error("DB_TRANSACTION_FAILED", { operation: options.operation, durationMs, error: thrown, errorCode });
    markErrorReported(thrown);
  } else {
    log.log(expected ? "DEBUG" : "WARN", "DB_TRANSACTION_ROLLBACK", { operation: options.operation, durationMs, error: thrown, errorCode });
  }

  if (options.operation) {
    log.log(expected ? "WARN" : "ERROR", `${options.operation}_FAILED` as EventName, { entityType: options.entityType, entityId: options.entityId, durationMs, error: thrown, errorCode });
    if (!expected) markErrorReported(thrown);
  }
}

export async function withTransaction<T>(fn: () => Promise<T>, options: TransactionOptions = {}): Promise<T> {
  if (getTransactionStore()) return fn(); // already inside one: this work is part of it

  const started = performance.now();
  const hooks: TransactionStore["hooks"] = [];
  let bodyError: unknown = NO_ERROR;

  let result: T;
  try {
    result = await rawPrisma.$transaction(
      async (client) => {
        try {
          return await runInTransactionStore({ client, hooks, operation: options.operation }, fn);
        } catch (error) {
          bodyError = error;
          throw error;
        }
      },
      { maxWait: options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS, timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS }
    );
  } catch (error) {
    report(error, bodyError, Math.round((performance.now() - started) * 100) / 100, options);
    throw error;
  }

  const durationMs = Math.round((performance.now() - started) * 100) / 100;
  outcomes.inc({ outcome: "commit" });
  durations.observe(durationMs, { outcome: "commit" });
  log.debug("DB_TRANSACTION_COMMIT", { operation: options.operation, durationMs });

  // Committed: now — and only now — what was waiting for it.
  for (const hook of hooks) {
    try {
      await hook();
    } catch (error) {
      log.error("SYSTEM_UNHANDLED_ERROR", { error, errorCode: "SYS-001", kind: "after-commit hook", operation: options.operation });
    }
  }
  return result;
}
