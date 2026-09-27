import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { handleApiError, ApiError } from "@/lib/apiError";
import { emailConfigured, sendTestMessage, smsProvider } from "@/lib/messaging";
import { normalizeIranMobile } from "@/lib/phone";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// Whether email and SMS can go out, and a test message to the owner's own address or phone.
// Never returns keys or passwords — only which settings are present.
async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({
      email: { configured: emailConfigured(), host: process.env.SMTP_HOST ?? null, from: process.env.SMTP_FROM ?? null },
      sms: { configured: smsProvider() !== null, provider: smsProvider() ?? (process.env.SMS_PROVIDER || null) },
      production: process.env.NODE_ENV === "production",
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const schema = z.object({ channel: z.enum(["EMAIL", "SMS"]) });

async function POST(req: NextRequest) {
  try {
    const adminId = await requireAdmin();
    const { channel } = schema.parse(await req.json());
    const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { email: true, phone: true, phoneVerifiedAt: true } });
    if (!admin) throw new ApiError("حساب پیدا نشد.", 404);
    if (channel === "EMAIL") {
      await sendTestMessage("EMAIL", admin.email);
      return NextResponse.json({ ok: true, sentTo: admin.email });
    }
    const phone = admin.phoneVerifiedAt && admin.phone ? normalizeIranMobile(admin.phone) : null;
    if (!phone) throw new ApiError("اول شماره موبایل حساب خودتان را در تنظیمات تأیید کنید.", 422, "VAL-001");
    await sendTestMessage("SMS", phone);
    return NextResponse.json({ ok: true, sentTo: phone });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/admin/messaging", GET);
const loggedPOST = withApiLogging("POST", "/api/admin/messaging", POST);
export { loggedGET as GET, loggedPOST as POST };
