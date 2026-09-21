// How a failed transaction is judged — the same way on the server (src/lib/transaction.ts) and on the
// phone (src/local/transaction.ts), so the two write the same story for the same failure.
import { ApiError } from "./apiErrorBase";
import { classifyError, codeForHttpStatus, type ErrorCode } from "./observability";

/** A failure the caller caused (not found, already paid, invalid input) rather than a fault in the system. */
export function isExpectedFailure(error: unknown): boolean {
  if (error instanceof ApiError) return error.status < 500;
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  return name === "ZodError" || name === "AuthError";
}

/** The stable code for an error — none for a caller's refusal that has no generic code (a 409 …), never a made-up one. */
export function failureCode(error: unknown): ErrorCode | undefined {
  if (error instanceof ApiError) return error.code ?? codeForHttpStatus(error.status);
  return classifyError(error) ?? "SYS-001";
}
