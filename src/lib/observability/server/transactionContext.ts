// The ambient database transaction of the code that is running right now, and the work that must wait
// for it to commit.
//
// A transaction is started by withTransaction (src/lib/transaction.ts). While its callback runs, this
// storage holds the Prisma transaction client, and the `prisma` export of src/lib/db.ts routes every
// call to it — so a helper three calls down that simply says `prisma.transaction.create(...)` takes part
// in the transaction without being handed anything, and cannot forget to.
//
// Server-only (node:async_hooks). It imports nothing from the database layer, so both the client
// wrapper (db.ts) and the modules that only want to say "after the commit" (the audit writer) can use it.
import { AsyncLocalStorage } from "node:async_hooks";

// (Isomorphic, so the phone's transaction wrapper can share it: see core/reportedErrors.ts.)
export { markErrorReported, isErrorReported } from "../core/reportedErrors";

export interface TransactionStore {
  /** The Prisma transaction client that `prisma.*` is routed to while the transaction is open. */
  client: object;
  /** Work to run once the transaction has committed — and only then. Thrown away on rollback. */
  hooks: Array<() => void | Promise<void>>;
  /** What the transaction is for (an OperationBase like TASK_CREATE), for the log. */
  operation?: string;
}

const STORAGE_KEY = Symbol.for("parva.transaction.storage.v1");

/** One storage per process even when this module is bundled twice (see observability/root.ts for why). */
function storage(): AsyncLocalStorage<TransactionStore> {
  const holder = globalThis as unknown as Record<symbol, AsyncLocalStorage<TransactionStore> | undefined>;
  let current = holder[STORAGE_KEY];
  if (!current) {
    current = new AsyncLocalStorage<TransactionStore>();
    holder[STORAGE_KEY] = current;
  }
  return current;
}

export function getTransactionStore(): TransactionStore | undefined {
  return storage().getStore();
}

export function runInTransactionStore<T>(store: TransactionStore, fn: () => T): T {
  return storage().run(store, fn);
}

/** True while a withTransaction callback is running (in this async chain). */
export function inTransaction(): boolean {
  return storage().getStore() !== undefined;
}

/**
 * Runs `fn` once the current transaction has committed; if it rolls back, `fn` never runs. Outside a
 * transaction there is nothing to wait for, so it runs now. This is how "success" — the history entry,
 * the *_SUCCESS log line — is kept from ever being written for something that was not committed.
 */
export function afterCommit(fn: () => void | Promise<void>): void {
  const store = storage().getStore();
  if (store) {
    store.hooks.push(fn);
    return;
  }
  try {
    const pending = fn();
    if (pending && typeof (pending as Promise<void>).catch === "function") (pending as Promise<void>).catch(() => undefined);
  } catch {
    // a hook that fails is the hook's own business; it must not fail the operation it follows
  }
}
