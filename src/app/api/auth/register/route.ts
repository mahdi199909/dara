import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { issueSession } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { seedDefaultCategoriesForUser } from "@/lib/defaults";
import { corsPreflight, withCors } from "@/lib/nativeCors";
import { accountLabel, passwordSchema } from "@/lib/accountLookup";
import { normalizeIranMobile } from "@/lib/phone";
import { checkRateLimit, LIMITS } from "@/lib/rateLimit";
import { logRateLimited, logRegisterFailed, logRegisterSuccess } from "@/lib/observability/server/authEvents";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// Sign-up without a code: on an email (older app builds send only this) or on a mobile number (stored unverified,
// see PHONE_SIGNUP_NEEDS_CODE in lib/phone.ts). One of the two is required.
const schema = z
  .object({
    name: z.string().trim().min(1, "نام الزامی است.").max(100),
    email: z.string().trim().max(254).email("ایمیل نامعتبر است.").optional(),
    phone: z.string().trim().max(40).optional(),
    password: passwordSchema,
  })
  .refine((b) => Boolean(b.email || b.phone), { message: "ایمیل یا شماره موبایل را وارد کنید.", path: ["email"] });

export async function OPTIONS() {
  return corsPreflight();
}

async function POST(req: NextRequest) {
  try {
    const { ipAddress, userAgent } = requestMeta(req);
    // Counted before anything else, so a script cannot fill the database with accounts.
    const rl = checkRateLimit(`register:ip:${ipAddress ?? "unknown"}`, LIMITS.registerPerIp);
    if (!rl.allowed) {
      logRateLimited({ email: "register", ip: ipAddress });
      throw new ApiError("تعداد ثبت‌نام از این اتصال بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.", 429, "AUTH-002", { retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) });
    }

    const body = schema.parse(await req.json());
    let email: string | null = null;
    let phone: string | null = null;
    if (body.email) {
      email = body.email.toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        logRegisterFailed({ email, reason: "email_taken", ip: ipAddress });
        throw new ApiError("این ایمیل قبلاً ثبت شده است. اگر رمز را فراموش کرده‌اید از «فراموشی رمز عبور» استفاده کنید.", 409, "AUTH-005");
      }
    } else {
      phone = normalizeIranMobile(body.phone ?? "");
      if (!phone) throw new ApiError("شماره موبایل معتبر وارد کنید (مثل 09121234567).", 400, "VAL-001");
      // Any account holding the number (verified or not) blocks a second sign-up on it; verifying the number by
      // code later (Settings, or the code sign-up) takes it over from an unverified claim.
      const existing = await prisma.user.findFirst({ where: { phone }, select: { id: true } });
      if (existing) {
        logRegisterFailed({ email: phone, reason: "email_taken", ip: ipAddress });
        throw new ApiError("این شماره موبایل قبلاً ثبت شده است. اگر رمز را فراموش کرده‌اید از «فراموشی رمز عبور» استفاده کنید.", 409, "AUTH-005");
      }
    }

    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: {
        name: body.name,
        email,
        phone,
        passwordHash,
        settings: { create: {} },
      },
    });

    await seedDefaultCategoriesForUser(user.id);

    await writeAuditLog({
      userId: user.id,
      action: "REGISTER",
      entityType: "User",
      entityId: user.id,
      ipAddress,
      userAgent,
    });

    const token = await issueSession(user);
    logRegisterSuccess({ userId: user.id, ip: ipAddress });

    return withCors(NextResponse.json({ id: user.id, name: user.name, email: accountLabel(user), token }));
  } catch (err) {
    return withCors(handleApiError(err));
  }
}

const loggedPOST = withApiLogging("POST", "/api/auth/register", POST);
export { loggedPOST as POST };
