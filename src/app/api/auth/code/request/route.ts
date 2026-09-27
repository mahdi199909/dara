import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/apiError";
import { requestMeta } from "@/lib/audit";
import { corsPreflight, withCors } from "@/lib/nativeCors";
import { requestPublicCode } from "@/lib/codeFlows";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// Public: someone who is not signed in asks for a code to sign in with, or to reset a forgotten password.
// The answer is the same whether or not the address/number has an account (see codeFlows.ts).
const schema = z.object({
  purpose: z.enum(["LOGIN_OTP", "RESET_PASSWORD"]),
  identifier: z.string().min(1, "ایمیل یا شماره موبایل را وارد کنید.").max(254),
});

export async function OPTIONS() {
  return corsPreflight();
}

async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const answer = await requestPublicCode({ purpose: body.purpose, identifier: body.identifier, ip: requestMeta(req).ipAddress });
    return withCors(NextResponse.json(answer));
  } catch (err) {
    return withCors(handleApiError(err));
  }
}

const loggedPOST = withApiLogging("POST", "/api/auth/code/request", POST);
export { loggedPOST as POST };
