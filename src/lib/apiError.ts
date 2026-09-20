import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "./auth";
import { ApiError } from "./apiErrorBase";
import { classifyError, codeForHttpStatus, getLogger, type ErrorCode } from "./observability";
import { getRequestContext, setRequestErrorCode } from "./observability/server/requestContext";

export { ApiError } from "./apiErrorBase";

const log = getLogger("api", "error-handler");

/**
 * Next.js signals "this route cannot be prerendered" by throwing while `next build` probes it, and the
 * routes' own catch blocks see it. It is control flow, not a failure — it never happens on a served request.
 */
function isNextDynamicUsage(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { digest?: unknown }).digest === "DYNAMIC_SERVER_USAGE";
}

/**
 * The body of every error response: the Persian message for the person, a stable DOMAIN-NNN code that
 * does not change when the wording does (support, tests and the app itself key off it), and the id of
 * this request so a bug report can be matched to the server's log line in one search.
 */
function errorBody(message: string, code: ErrorCode | undefined, extra?: Record<string, unknown>): Record<string, unknown> {
  const requestId = getRequestContext()?.requestId;
  return { error: message, ...(code ? { code } : {}), ...(requestId ? { requestId } : {}), ...extra };
}

export function handleApiError(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    setRequestErrorCode("AUTH-003");
    return NextResponse.json(errorBody("احراز هویت نشده‌اید.", "AUTH-003"), { status: 401 });
  }
  if (err instanceof ZodError) {
    setRequestErrorCode("VAL-001");
    return NextResponse.json(errorBody("اطلاعات ارسالی نامعتبر است.", "VAL-001", { details: err.flatten() }), { status: 400 });
  }
  if (err instanceof ApiError) {
    const code = err.code ?? codeForHttpStatus(err.status);
    if (code) setRequestErrorCode(code);
    return NextResponse.json(errorBody(err.message, code), { status: err.status });
  }
  // The one place an unexpected exception is recorded (its stack stays in the server log; the
  // person only ever sees the generic message below, plus the code and request id to quote).
  const code = classifyError(err) ?? "SYS-001";
  setRequestErrorCode(code);
  if (!isNextDynamicUsage(err)) log.error("API_UNHANDLED_ERROR", { error: err, errorCode: code });
  return NextResponse.json(errorBody("خطایی رخ داد. دوباره تلاش کنید.", code), { status: 500 });
}
