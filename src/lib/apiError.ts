import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "./auth";
import { ApiError } from "./apiErrorBase";
import { classifyError, getLogger } from "./observability";

export { ApiError } from "./apiErrorBase";

const log = getLogger("api", "error-handler");

export function handleApiError(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: "احراز هویت نشده‌اید." }, { status: 401 });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: "اطلاعات ارسالی نامعتبر است.", details: err.flatten() },
      { status: 400 }
    );
  }
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  // The one place an unexpected exception is recorded (its stack stays in the server log; the
  // person only ever sees the generic message below).
  log.error("API_UNHANDLED_ERROR", { error: err, errorCode: classifyError(err) ?? "SYS-001" });
  return NextResponse.json({ error: "خطایی رخ داد. دوباره تلاش کنید." }, { status: 500 });
}
