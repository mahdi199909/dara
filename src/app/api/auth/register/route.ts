import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createSessionToken, setSessionCookie } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { seedDefaultCategoriesForUser } from "@/lib/defaults";

const schema = z.object({
  name: z.string().min(1, "نام الزامی است.").max(100),
  email: z.string().email("ایمیل نامعتبر است."),
  password: z.string().min(6, "رمز عبور باید حداقل ۶ کاراکتر باشد."),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const email = body.email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new ApiError("این ایمیل قبلاً ثبت شده است.", 409);

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

    return NextResponse.json({ id: user.id, name: user.name, email: user.email });
  } catch (err) {
    return handleApiError(err);
  }
}
