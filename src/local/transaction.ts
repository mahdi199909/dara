// Real database transactions on the phone, for everything that writes more than one row.
//
//   withLocalTransaction(db, () => {
//     const task = insertTask(db, …);
//     syncTaskDirectCost(db, task.id);              // its writes are part of the same transaction
//     writeLocalAuditLog(db, { … });                // the history entry is too — and so is its absence, on failure
//     return task;
//   }, { operation: "TASK_CREATE", entityType: "Task" });
//
// Everything the callback writes commits together or not at all, so a failure half-way through leaves the
// database exactly as it was: no task without its expense, no timer that stopped without its total, no
// half-merged categories. What the log says can then be trusted, as on the server (src/lib/transaction.ts):
//   - commit    → DB_TRANSACTION_COMMIT (DEBUG); work queued with afterLocalCommit() runs — the *_SUCCESS
//                 line is exactly that, so success is never logged for something that was rolled back;
//   - rollback  → DB_TRANSACTION_ROLLBACK, and <OPERATION>_FAILED when an operation was named; queued work is
//                 discarded; the error is rethrown unchanged;
//   - the transaction machinery failed (BEGIN or COMMIT refused) → DB_TRANSACTION_FAILED.
//
// The callback must be synchronous. The phone's database is a single in-memory SQLite that is written out
// to a file from a timer and on pagehide; a transaction that stayed open across an `await` could be exported
// half-written. Every repository and route handler here is synchronous, so this costs nothing — and an async
// callback is refused (and rolled back) rather than trusted.
//
// Called inside another withLocalTransaction on the same database, it joins it: the outermost one owns the
// commit and the rollback (so there is never a BEGIN inside a BEGIN).
import type { LocalDb } from "./db";
import { getLogger, markErrorReported, type EventName, type OperationBase } from "../lib/observability";
import { failureCode, isExpectedFailure } from "../lib/transactionFailure";

// No fixed module: DB_TRANSACTION_* belong to the database, TASK_CREATE_FAILED to tasks.
const log = getLogger(null, "local-transaction");

export interface LocalTransactionOptions {
  /** The operation this transaction is part of; on rollback its <OPERATION>_FAILED event is written. */
  operation?: OperationBase;
  entityType?: string;
  entityId?: string;
}

interface OpenTransaction {
  /** Work to run once the transaction has committed — and only then. Thrown away on rollback. */
  hooks: Array<() => void>;
}

/** The databases that have a transaction open right now (there is normally one database, and at most one transaction). */
const open = new WeakMap<LocalDb, OpenTransaction>();

/** True while a withLocalTransaction callback is running on `db`. */
export function inLocalTransaction(db: LocalDb): boolean {
  return open.has(db);
}

function runHook(hook: () => void, operation?: OperationBase): void {
  try {
    hook();
  } catch (error) {
    // a hook that fails is the hook's own business; it must not fail the operation it follows
    log.error("SYSTEM_UNHANDLED_ERROR", { error, errorCode: "SYS-001", layer: "local", kind: "after-commit hook", operation });
  }
}

/**
 * Runs `hook` once the current transaction has committed; if it rolls back, `hook` never runs. With no
 * transaction open there is nothing to wait for, so it runs now. This is how the *_SUCCESS line is kept
 * from ever being written for a change that was not committed.
 */
export function afterLocalCommit(db: LocalDb, hook: () => void): void {
  const transaction = open.get(db);
  if (transaction) transaction.hooks.push(hook);
  else runHook(hook);
}

function isThenable(value: unknown): boolean {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

function elapsedSince(started: number): number {
  return Math.round((performance.now() - started) * 100) / 100;
}

/** Undoes the open transaction. If SQLite already did (a full disk, an I/O error), there is nothing left to undo. */
function rollBack(db: LocalDb, options: LocalTransactionOptions, durationMs: number): void {
  try {
    db.execute("ROLLBACK");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no transaction is active/i.test(message)) return;
    log.error("DB_TRANSACTION_FAILED", { operation: options.operation, durationMs, error, errorCode: "DB-003", layer: "local", message: "the rollback itself failed" });
    markErrorReported(error);
  }
}

function report(error: unknown, kind: "rollback" | "failed", durationMs: number, options: LocalTransactionOptions): void {
  const expected = kind === "rollback" && isExpectedFailure(error);
  const errorCode = kind === "failed" ? "DB-003" : failureCode(error);

  if (kind === "failed") {
    log.error("DB_TRANSACTION_FAILED", { operation: options.operation, durationMs, error, errorCode, layer: "local" });
    markErrorReported(error);
  } else {
    log.log(expected ? "DEBUG" : "WARN", "DB_TRANSACTION_ROLLBACK", { operation: options.operation, durationMs, error, errorCode, layer: "local" });
  }

  if (options.operation) {
    log.log(expected ? "WARN" : "ERROR", `${options.operation}_FAILED` as EventName, {
      entityType: options.entityType,
      entityId: options.entityId,
      durationMs,
      error,
      errorCode,
      layer: "local",
    });
    if (!expected) markErrorReported(error);
  }
}

export function withLocalTransaction<T>(db: LocalDb, fn: () => T, options: LocalTransactionOptions = {}): T {
  if (open.has(db)) return fn(); // already inside one: this work is part of it

  const started = performance.now();
  try {
    db.execute("BEGIN");
  } catch (error) {
    report(error, "failed", elapsedSince(started), options);
    throw error;
  }
  const transaction: OpenTransaction = { hooks: [] };
  open.set(db, transaction);

  let result: T;
  try {
    result = fn();
    if (isThenable(result)) {
      throw new TypeError("withLocalTransaction was given an async function; a phone transaction must finish before control returns to the event loop");
    }
  } catch (error) {
    open.delete(db);
    const durationMs = elapsedSince(started);
    rollBack(db, options, durationMs);
    report(error, "rollback", durationMs, options);
    throw error;
  }

  try {
    db.execute("COMMIT");
  } catch (error) {
    open.delete(db);
    const durationMs = elapsedSince(started);
    rollBack(db, options, durationMs);
    report(error, "failed", durationMs, options);
    throw error;
  }
  open.delete(db);
  log.debug("DB_TRANSACTION_COMMIT", { operation: options.operation, durationMs: elapsedSince(started), layer: "local" });

  // Committed: now — and only now — what was waiting for it.
  for (const hook of transaction.hooks) runHook(hook, options.operation);
  return result;
}
