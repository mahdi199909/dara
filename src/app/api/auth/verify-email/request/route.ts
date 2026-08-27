import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { handleApiError, ApiError } from "@/lib/apiError";
import { checkRateLimit } from "@/lib/rateLimit";
import { sendEmail } from "@/lib/email";
import { corsPreflight, withCors } from "@/lib/nativeCors";

const schema = z.object({ email: z.string().email("ایمیل نامعتبر است.") });

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function OPTIONS() {
  return corsPreflight();
}

// Step 1 of registration: send a 6-digit code to the email the visitor claims to own. Deliberately
// not a Prisma User check bypass — an email already tied to a real account is rejected here too,
// same message /api/auth/register itself would give, just surfaced a step earlier.
export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const email = body.email.toLowerCase().trim();

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) throw new ApiError("این ایمیل قبلاً ثبت شده است.", 409);

    const rl = checkRateLimit(`verify-email:${email}`);
    if (!rl.allowed) throw new ApiError("تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.", 429);

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.emailVerification.upsert({
      where: { email },
      create: { email, code, expiresAt },
      update: { code, expiresAt, verifiedAt: null, attempts: 0 },
    });

    await sendEmail(
      email,
      "کد تأیید دارا",
      `<div dir="rtl" style="font-family: sans-serif;"><p>کد تأیید شما برای ثبت‌نام در دارا:</p><p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${code}</p><p style="color: #6b7280; font-size: 13px;">این کد تا ۱۰ دقیقه دیگر معتبر است.</p></div>`
    );

    return withCors(NextResponse.json({ ok: true }));
  } catch (err) {
    return withCors(handleApiError(err));
  }
}
