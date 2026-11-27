import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { issueSession } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { seedDefaultCategoriesForUser } from "@/lib/defaults";
import { corsPreflight, withCors } from "@/lib/nativeCors";
import { accountLabel, codeSchema, findAccount, passwordSchema } from "@/lib/accountLookup";
import { verifyRegisterCode } from "@/lib/codeFlows";
import { checkRateLimit, LIMITS } from "@/lib/rateLimit";
import { logRateLimited, logRegisterSuccess } from "@/lib/observability/server/authEvents";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// Public: create an account on an email address OR an Iranian mobile number, proven by the code that
// /api/auth/code/request (purpose REGISTER) sent there. Email and phone are separate columns; the one
// used here is stored already verified, and either one can sign in afterwards.
const schema = z.object({
  name: z.string().trim().min(1, "نام الزامی است.").max(100),
  identifier: z.string().min(1, "ایمیل یا شماره موبایل را وارد کنید.").max(254),
  code: codeSchema,
  password: passwordSchema,
});

export async function OPTIONS() {
  return corsPreflight();
}

async function POST(req: NextRequest) {
  try {
    const { ipAddress, userAgent } = requestMeta(req);
    const rl = checkRateLimit(`register:ip:${ipAddress ?? "unknown"}`, LIMITS.registerPerIp);
    if (!rl.allowed) {
      logRateLimited({ email: "register", ip: ipAddress });
      throw new ApiError("تعداد ثبت‌نام از این اتصال بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.", 429, "AUTH-002", { retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) });
    }

    const body = schema.parse(await req.json());
    const id = await verifyRegisterCode({ identifier: body.identifier, code: body.code, ip: ipAddress });
    if (await findAccount(id)) throw new ApiError("این شناسه قبلاً ثبت شده است. وارد شوید.", 409, "AUTH-005");

    const now = new Date();
    const passwordHash = await hashPassword(body.password);
    let user;
    if (id.channel === "EMAIL") {
      user = await prisma.user.create({ data: { name: body.name, email: id.target, emailVerifiedAt: now, passwordHash, settings: { create: {} } } });
    } else {
      // Someone's earlier, never-verified claim on this number must not block the person who just proved it.
      await prisma.user.updateMany({ where: { phone: id.target, phoneVerifiedAt: null }, data: { phone: null } });
      user = await prisma.user.create({ data: { name: body.name, phone: id.target, phoneVerifiedAt: now, passwordHash, settings: { create: {} } } });
    }

    await seedDefaultCategoriesForUser(user.id);
    await writeAuditLog({ userId: user.id, action: "REGISTER", entityType: "User", entityId: user.id, newValue: { channel: id.channel }, ipAddress, userAgent });
    const token = await issueSession(user);
    logRegisterSuccess({ userId: user.id, ip: ipAddress });

    return withCors(NextResponse.json({ id: user.id, name: user.name, email: accountLabel(user), phone: user.phone, token }));
  } catch (err) {
    return withCors(handleApiError(err));
  }
}

const loggedPOST = withApiLogging("POST", "/api/auth/code/register", POST);
export { loggedPOST as POST };
