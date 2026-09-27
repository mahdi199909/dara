import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId, issueSession } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { corsPreflight, withCors } from "@/lib/nativeCors";
import { passwordSchema } from "@/lib/accountLookup";
import { checkRateLimit, LIMITS } from "@/lib/rateLimit";
import { logPasswordChanged } from "@/lib/observability/server/authEvents";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// Changing the password while signed in. Every other session ends; this device gets a fresh token
// (returned for the app, which keeps its token itself).
const schema = z.object({
  currentPassword: z.string().min(1, "رمز فعلی را وارد کنید.").max(200),
  newPassword: passwordSchema,
});

export async function OPTIONS() {
  return corsPreflight();
}

async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const { ipAddress, userAgent } = requestMeta(req);
    const rl = checkRateLimit(`password:acct:${userId}`, LIMITS.passwordChangePerAccount);
    if (!rl.allowed) throw new ApiError("تعداد تلاش‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.", 429, "AUTH-002");

    const body = schema.parse(await req.json());
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
      throw new ApiError("رمز فعلی اشتباه است.", 400, "AUTH-001");
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(body.newPassword), passwordChangedAt: new Date(), sessionVersion: { increment: 1 } },
      select: { id: true, email: true, sessionVersion: true },
    });
    const token = await issueSession(updated);
    await writeAuditLog({ userId, action: "PASSWORD_CHANGE", entityType: "User", entityId: userId, ipAddress, userAgent });
    logPasswordChanged({ userId, ip: ipAddress });
    return withCors(NextResponse.json({ ok: true, token }));
  } catch (err) {
    return withCors(handleApiError(err));
  }
}

const loggedPOST = withApiLogging("POST", "/api/account/password", POST);
export { loggedPOST as POST };
