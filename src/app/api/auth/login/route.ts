import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSessionToken, setSessionCookie } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rateLimit";

const schema = z.object({
  email: z.string().email("ایمیل نامعتبر است."),
  password: z.string().min(1, "رمز عبور الزامی است."),
});

export async function POST(req: NextRequest) {
  try {
    const { ipAddress, userAgent } = requestMeta(req);
    const body = schema.parse(await req.json());
    const email = body.email.toLowerCase().trim();

    const rl = checkRateLimit(`login:${ipAddress ?? "unknown"}:${email}`);
    if (!rl.allowed) {
      throw new ApiError("تعداد تلاش‌های ورود بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.", 429);
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      throw new ApiError("ایمیل یا رمز عبور اشتباه است.", 401);
    }

    const token = await createSessionToken({ userId: user.id, email: user.email });
    await setSessionCookie(token);

    await writeAuditLog({
      userId: user.id,
      action: "LOGIN",
      entityType: "User",
      entityId: user.id,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ id: user.id, name: user.name, email: user.email });
  } catch (err) {
    return handleApiError(err);
  }
}
