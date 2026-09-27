import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { requestMeta } from "@/lib/audit";
import { corsPreflight, withCors } from "@/lib/nativeCors";
import { normalizeIranMobile } from "@/lib/phone";
import { assertPhoneFree, requestContactCode } from "@/lib/codeFlows";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// Adding or changing the mobile number. The number is only saved on the account once its code comes
// back (see ../verify), so a typo never replaces a working number.
const schema = z.object({ phone: z.string().min(1).max(32) });

export async function OPTIONS() {
  return corsPreflight();
}

async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const body = schema.parse(await req.json());
    const phone = normalizeIranMobile(body.phone);
    if (!phone) throw new ApiError("شماره موبایل معتبر وارد کنید (مثل 09121234567).", 400, "VAL-001");
    await assertPhoneFree(phone, userId);
    const answer = await requestContactCode({ userId, channel: "SMS", target: phone, ip: requestMeta(req).ipAddress });
    return withCors(NextResponse.json({ ...answer, phone }));
  } catch (err) {
    return withCors(handleApiError(err));
  }
}

const loggedPOST = withApiLogging("POST", "/api/account/phone/send-code", POST);
export { loggedPOST as POST };
