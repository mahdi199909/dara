import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createSessionToken, setSessionCookie } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { seedDefaultCategoriesForUser } from "@/lib/defaults";
import { corsPreflight, withCors } from "@/lib/nativeCors";

const schema = z.object({
  name: z.string().min(1, "نام الزامی است.").max(100),
  email: z.string().email("ایمیل نامعتبر است."),
  password: z.string().min(6, "رمز عبور باید حداقل ۶ کاراکتر باشد."),
});

export async function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const email = body.email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new ApiError("این ایمیل قبلاً ثبت شده است.", 409);

    // Requires /api/auth/verify-email/{request,confirm} to have already run for this exact
    // email — a 30-minute window between confirming the code and finishing this form (not just
    // "must exist"), so a code can't be confirmed once and then reused arbitrarily later.
    const verification = await prisma.emailVerification.findUnique({ where: { email } });
    const VERIFICATION_WINDOW_MS = 30 * 60 * 1000;
    if (!verification?.verifiedAt || Date.now() - verification.verifiedAt.getTime() > VERIFICATION_WINDOW_MS) {
      throw new ApiError("ایمیل تأیید نشده است. لطفاً دوباره کد تأیید رو دریافت کنید.", 400);
    }

    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: {
        name: body.name.trim(),
        email,
        passwordHash,
        settings: { create: {} },
      },
    });

    await seedDefaultCategoriesForUser(user.id);
    // Consumed — delete rather than leave verifiedAt sitting there, so it can never be reused
    // (a re-register attempt with the same email will fail on the User uniqueness check above
    // long before it would ever reach this table again anyway, but this keeps it tidy).
    await prisma.emailVerification.delete({ where: { email } }).catch(() => {});

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId: user.id,
      action: "REGISTER",
      entityType: "User",
      entityId: user.id,
      ipAddress,
      userAgent,
    });

    const token = await createSessionToken({ userId: user.id, email: user.email });
    await setSessionCookie(token);

    return withCors(NextResponse.json({ id: user.id, name: user.name, email: user.email, token }));
  } catch (err) {
    return withCors(handleApiError(err));
  }
}
