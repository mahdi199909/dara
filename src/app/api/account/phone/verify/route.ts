import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { corsPreflight, withCors } from "@/lib/nativeCors";
import { normalizeIranMobile } from "@/lib/phone";
import { codeSchema } from "@/lib/accountLookup";
import { assertPhoneFree, verifyContactCode } from "@/lib/codeFlows";
import { logContactVerified } from "@/lib/observability/server/authEvents";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

const schema = z.object({ phone: z.string().min(1).max(32), code: codeSchema });

export async function OPTIONS() {
  return corsPreflight();
}

async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const { ipAddress, userAgent } = requestMeta(req);
    const body = schema.parse(await req.json());
    const phone = normalizeIranMobile(body.phone);
    if (!phone) throw new ApiError("شماره موبایل معتبر وارد کنید.", 400, "VAL-001");
    await verifyContactCode({ userId, channel: "SMS", target: phone, code: body.code, ip: ipAddress });
    await assertPhoneFree(phone, userId);

    const before = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    // Another account's stale, never-verified claim on the same number would trip the unique index.
    await prisma.user.updateMany({ where: { phone, phoneVerifiedAt: null, NOT: { id: userId } }, data: { phone: null } });
    await prisma.user.update({ where: { id: userId }, data: { phone, phoneVerifiedAt: new Date() } });

    await writeAuditLog({ userId, action: "VERIFY_PHONE", entityType: "User", entityId: userId, oldValue: { phone: before?.phone ?? null }, newValue: { phone }, ipAddress, userAgent });
    logContactVerified({ userId, channel: "SMS" });
    return withCors(NextResponse.json({ ok: true, phone, phoneVerified: true }));
  } catch (err) {
    return withCors(handleApiError(err));
  }
}

const loggedPOST = withApiLogging("POST", "/api/account/phone/verify", POST);
export { loggedPOST as POST };
