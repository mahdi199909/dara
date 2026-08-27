import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { handleApiError, ApiError } from "@/lib/apiError";
import { corsPreflight, withCors } from "@/lib/nativeCors";

const schema = z.object({ email: z.string().email(), code: z.string().length(6) });
const MAX_ATTEMPTS = 5;

export async function OPTIONS() {
  return corsPreflight();
}

// Step 2: check the code, and if it matches, mark this email verified. Doesn't create the
// account itself — /api/auth/register (step 3) does that, and requires a recent verifiedAt here
// (see that route) so this endpoint alone can never be enough to get an account created.
export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const email = body.email.toLowerCase().trim();

    const record = await prisma.emailVerification.findUnique({ where: { email } });
    if (!record) throw new ApiError("ابتدا باید کد تأیید رو درخواست بدید.", 400);
    if (record.expiresAt < new Date()) throw new ApiError("کد تأیید منقضی شده است. دوباره درخواست بدید.", 400);
    if (record.attempts >= MAX_ATTEMPTS) throw new ApiError("تعداد تلاش‌های نادرست بیش از حد مجاز است. دوباره درخواست بدید.", 429);

    if (record.code !== body.code) {
      await prisma.emailVerification.update({ where: { email }, data: { attempts: { increment: 1 } } });
      throw new ApiError("کد وارد شده اشتباه است.", 400);
    }

    await prisma.emailVerification.update({ where: { email }, data: { verifiedAt: new Date() } });

    return withCors(NextResponse.json({ ok: true }));
  } catch (err) {
    return withCors(handleApiError(err));
  }
}
