import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { issueSession } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { seedDefaultCategoriesForUser } from "@/lib/defaults";
import { corsPreflight, withCors } from "@/lib/nativeCors";
import { passwordSchema } from "@/lib/accountLookup";
import { checkRateLimit, LIMITS } from "@/lib/rateLimit";
import { logRateLimited, logRegisterFailed, logRegisterSuccess } from "@/lib/observability/server/authEvents";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

const schema = z.object({
  name: z.string().trim().min(1, "نام الزامی است.").max(100),
  email: z.string().trim().max(254).email("ایمیل نامعتبر است."),
  password: passwordSchema,
});

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
    const email = body.email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      logRegisterFailed({ email, reason: "email_taken", ip: ipAddress });
      throw new ApiError("این ایمیل قبلاً ثبت شده است. اگر رمز را فراموش کرده‌اید از «فراموشی رمز عبور» استفاده کنید.", 409, "AUTH-005");
    }

    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: {
        name: body.name,
        email,
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

    return withCors(NextResponse.json({ id: user.id, name: user.name, email: user.email, token }));
  } catch (err) {
    return withCors(handleApiError(err));
  }
}

const loggedPOST = withApiLogging("POST", "/api/auth/register", POST);
export { loggedPOST as POST };
