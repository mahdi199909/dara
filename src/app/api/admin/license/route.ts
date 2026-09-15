import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { handleApiError, ApiError } from "@/lib/apiError";

async function findUserByEmail(email: string) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true } });
  if (!user) throw new ApiError("کاربری با این ایمیل پیدا نشد.", 404);
  return user;
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const email = req.nextUrl.searchParams.get("email");
    if (!email) throw new ApiError("ایمیل را وارد کنید.", 400);

    const user = await findUserByEmail(email);
    const license = await prisma.license.findUnique({ where: { userId: user.id } });
    return NextResponse.json({ user, license });
  } catch (err) {
    return handleApiError(err);
  }
}

const updateSchema = z.object({
  email: z.string().email(),
  status: z.enum(["FREE", "TRIAL", "SUBSCRIBED", "LIFETIME"]),
  // Only meaningful for SUBSCRIBED — how many months from *now* the new period should run.
  // Ignored for the other three statuses (their currentPeriodEnd is always cleared instead).
  months: z.number().int().min(1).max(24).optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const body = updateSchema.parse(await req.json());
    const user = await findUserByEmail(body.email);

    if (body.status === "SUBSCRIBED" && !body.months) {
      throw new ApiError("برای وضعیت مشترک، تعداد ماه را مشخص کنید.", 422);
    }

    const currentPeriodEnd =
      body.status === "SUBSCRIBED" && body.months
        ? new Date(Date.now() + body.months * 30 * 86_400_000)
        : null;
    // A fresh TRIAL grant restarts the same 30-day window /api/license/status itself would have
    // started on first login — admin-granted trials should feel identical to an organic one.
    const trialEndsAt = body.status === "TRIAL" ? new Date(Date.now() + 30 * 86_400_000) : null;

    const license = await prisma.license.upsert({
      where: { userId: user.id },
      create: { userId: user.id, status: body.status, currentPeriodEnd, trialEndsAt },
      update: { status: body.status, currentPeriodEnd, trialEndsAt },
    });

    return NextResponse.json({ user, license });
  } catch (err) {
    return handleApiError(err);
  }
}
