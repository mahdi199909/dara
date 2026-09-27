import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { corsPreflight, withCors } from "@/lib/nativeCors";
import { channelAvailable } from "@/lib/messaging";
import { isAdminAccount } from "@/lib/adminIdentity";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// The signed-in person's security details, for Settings' «امنیت حساب» on the web and in the app.
export async function OPTIONS() {
  return corsPreflight();
}

async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, emailVerifiedAt: true, phone: true, phoneVerifiedAt: true, passwordChangedAt: true, createdAt: true, disabledAt: true },
    });
    if (!user) throw new ApiError("حساب پیدا نشد.", 404);
    return withCors(
      NextResponse.json({
        name: user.name,
        email: user.email,
        emailVerified: Boolean(user.emailVerifiedAt),
        phone: user.phoneVerifiedAt ? user.phone : null,
        phoneVerified: Boolean(user.phone && user.phoneVerifiedAt),
        passwordChangedAt: user.passwordChangedAt,
        isAdmin: isAdminAccount(user),
        channels: { email: await channelAvailable("EMAIL"), sms: await channelAvailable("SMS") },
      })
    );
  } catch (err) {
    return withCors(handleApiError(err));
  }
}

const loggedGET = withApiLogging("GET", "/api/account", GET);
export { loggedGET as GET };
