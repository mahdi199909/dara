import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "./auth";
import { ApiError } from "./apiErrorBase";

export { ApiError } from "./apiErrorBase";

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
  console.error(err);
  return NextResponse.json({ error: "خطایی رخ داد. دوباره تلاش کنید." }, { status: 500 });
}
