// Errors that have already been written to the log in full (with their stack), so that the layer above
// — the API error handler on the server, the request dispatcher on the phone — does not write the same
// failure a second time under another name.
//
// A transaction that rolls back writes <OPERATION>_FAILED with the error; the error then travels on to
// the code that turns it into a response, which would otherwise log it again as API_UNHANDLED_ERROR.
// Isomorphic (no Node imports): the phone's transaction wrapper and the server's both use it.

/** One set per process even when this module is bundled twice (see observability/root.ts for why). */
const REPORTED_KEY = Symbol.for("parva.transaction.reportedErrors.v1");

function reported(): WeakSet<object> {
  const holder = globalThis as unknown as Record<symbol, WeakSet<object> | undefined>;
  let current = holder[REPORTED_KEY];
  if (!current) {
    current = new WeakSet<object>();
    holder[REPORTED_KEY] = current;
  }
  return current;
}

/** Remembers that `error` was logged in full, so the layer above does not write it a second time. */
export function markErrorReported(error: unknown): void {
  if (typeof error === "object" && error !== null) reported().add(error);
}

export function isErrorReported(error: unknown): boolean {
  return typeof error === "object" && error !== null && reported().has(error);
}
