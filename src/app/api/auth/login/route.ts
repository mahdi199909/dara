import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyPassword } from "@/lib/password";
import { issueSession, accountDisabledError } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { hitLimits, LIMITS, resetRateLimit } from "@/lib/rateLimit";
import { corsPreflight, withCors } from "@/lib/nativeCors";
import { findAccount, parseIdentifier, TIMING_DUMMY_HASH } from "@/lib/accountLookup";
import { logAccountDisabled, logLoginFailed, logLoginSuccess, logRateLimited } from "@/lib/observability/server/authEvents";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// `email` is what every app build so far sends; `identifier` (email or a verified mobile number) is the
// newer field. Either one is enough.
const schema = z
  .object({
    email: z.string().max(254).optional(),
    identifier: z.string().max(254).optional(),
    password: z.string().min(1, "رمز عبور الزامی است.").max(200),
  })
  .refine((b) => Boolean(b.identifier || b.email), { message: "ایمیل یا شماره موبایل را وارد کنید.", path: ["identifier"] });

export async function OPTIONS() {
  return corsPreflight();
}

async function POST(req: NextRequest) {
  try {
    const { ipAddress, userAgent } = requestMeta(req);
    const body = schema.parse(await req.json());
    const id = parseIdentifier(body.identifier ?? body.email ?? "");

    const accountKey = `login:acct:${id.target}`;
    const rl = hitLimits([
      [accountKey, LIMITS.loginPerAccount],
      [`login:ip:${ipAddress ?? "unknown"}`, LIMITS.loginPerIp],
    ]);
    if (!rl.allowed) {
      logRateLimited({ email: id.target, ip: ipAddress });
      throw new ApiError("تعداد تلاش‌های ورود بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.", 429, "AUTH-002", { retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) });
    }

    const user = await findAccount(id);
    // Always pay for one bcrypt comparison, so the response time does not tell whether the account exists.
    const passwordOk = await verifyPassword(body.password, user?.passwordHash ?? TIMING_DUMMY_HASH);
    if (!user || !passwordOk) {
      logLoginFailed({ email: id.target, reason: user ? "wrong_password" : "no_such_user", ip: ipAddress });
      throw new ApiError(id.channel === "EMAIL" ? "ایمیل یا رمز عبور اشتباه است." : "شماره موبایل یا رمز عبور اشتباه است.", 401, "AUTH-001");
    }
    if (user.disabledAt) {
      logAccountDisabled({ userId: user.id });
      throw accountDisabledError();
    }

    resetRateLimit(accountKey);
    const token = await issueSession(user);

    await writeAuditLog({
      userId: user.id,
      action: "LOGIN",
      entityType: "User",
      entityId: user.id,
      ipAddress,
      userAgent,
    });
    logLoginSuccess({ userId: user.id, ip: ipAddress });

    // `token` lets the Android app carry this session as a bearer token (see requireUserId) —
    // the web frontend already has it via the Set-Cookie header above and simply ignores this field.
    return withCors(NextResponse.json({ id: user.id, name: user.name, email: user.email, token }));
  } catch (err) {
    return withCors(handleApiError(err));
  }
}

const loggedPOST = withApiLogging("POST", "/api/auth/login", POST);
export { loggedPOST as POST };
