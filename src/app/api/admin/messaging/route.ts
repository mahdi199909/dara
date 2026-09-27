import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { confirmAdminPassword, requireAdmin } from "@/lib/admin";
import { handleApiError, ApiError } from "@/lib/apiError";
import { audit } from "@/lib/audit";
import { emailConfigured, sendTestMessage, smsProvider } from "@/lib/messaging";
import { describeMessagingSettings, saveMessagingSettings, SettingsValidationError } from "@/lib/serverSettings";
import { normalizeIranMobile } from "@/lib/phone";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// The owner's email/SMS settings: what is configured and from where (GET), saving new values (PUT,
// password re-entered), and a test message to the owner's own address or phone (POST).
// Secret values (passwords, API keys) are never part of any response.
async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(
      {
        fields: await describeMessagingSettings(),
        email: { configured: await emailConfigured() },
        sms: { configured: (await smsProvider()) !== null, provider: await smsProvider() },
        production: process.env.NODE_ENV === "production",
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (err) {
    return handleApiError(err);
  }
}

const saveSchema = z.object({
  password: z.string().min(1).max(200),
  // A string sets the value, null clears it (back to the server's .env); absent keys stay as they are.
  values: z.record(z.string(), z.string().max(500).nullable()),
});

async function PUT(req: NextRequest) {
  try {
    const adminId = await requireAdmin();
    const body = saveSchema.parse(await req.json());
    await confirmAdminPassword(adminId, body.password);
    let changed: string[];
    try {
      changed = await saveMessagingSettings(body.values, adminId);
    } catch (err) {
      if (err instanceof SettingsValidationError) throw new ApiError(err.message, 422, "VAL-001");
      throw err;
    }
    // Which settings changed — never their values.
    await audit.log({ event: "SERVER_SETTINGS_ADMIN_UPDATED", entityType: "ServerSetting", metadata: { changed }, source: "admin", req });
    return NextResponse.json({ ok: true, changed, fields: await describeMessagingSettings() });
  } catch (err) {
    return handleApiError(err);
  }
}

const testSchema = z.object({ channel: z.enum(["EMAIL", "SMS"]) });

async function POST(req: NextRequest) {
  try {
    const adminId = await requireAdmin();
    const { channel } = testSchema.parse(await req.json());
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
const loggedPUT = withApiLogging("PUT", "/api/admin/messaging", PUT);
const loggedPOST = withApiLogging("POST", "/api/admin/messaging", POST);
export { loggedGET as GET, loggedPUT as PUT, loggedPOST as POST };
