import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { EVENT_COLUMN, EVENT_WINDOW_MS, eventSchema } from "@/lib/checkup";
import { BodyTooLargeError, ipBucket, readCappedText } from "@/lib/checkupServer";
import { clientIp } from "@/lib/clientIp";
import { isAllowedOrigin, publicPreflight, withPublicCors } from "@/lib/publicCors";
import { LIMITS, checkRateLimit } from "@/lib/rateLimit";
import { getLogger, type ErrorCode } from "@/lib/observability";
import { setRequestErrorCode } from "@/lib/observability/server/requestContext";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// What a respondent did with their report (viewed it, shared or saved its card, followed an invite) — the
// kit's strongest signal. Public like /api/checkup and guarded the same way; it only stamps the first time
// of each kind on a sheet that already exists and is at most a week old, so an invented id writes nothing.
const log = getLogger("checkup", "api");

export async function OPTIONS(req: Request) {
  return publicPreflight(req);
}

function reply(req: Request, status: number, code?: ErrorCode): Response {
  if (code) setRequestErrorCode(code);
  return withPublicCors(req, NextResponse.json(code ? { ok: false, code } : { ok: true }, { status, headers: { "Cache-Control": "no-store" } }));
}

async function POST(req: Request) {
  if (!isAllowedOrigin(req.headers.get("origin"))) {
    log.warn("CHECKUP_REFUSED", { reason: "origin", errorCode: "CHECKUP-004" });
    return reply(req, 403, "CHECKUP-004");
  }
  const bucket = ipBucket(clientIp(req)) ?? "unknown";
  if (!checkRateLimit(`checkup-write:${bucket}`, LIMITS.checkupWritePerIp).allowed) {
    log.warn("CHECKUP_RATE_LIMITED", { limit: "write", errorCode: "CHECKUP-002" });
    return reply(req, 429, "CHECKUP-002");
  }
  let json: unknown;
  try {
    json = JSON.parse(await readCappedText(req, 1024));
  } catch (err) {
    if (err instanceof BodyTooLargeError) return reply(req, 413, "CHECKUP-005");
    json = undefined;
  }
  const parsed = eventSchema.safeParse(json);
  if (!parsed.success) {
    log.warn("CHECKUP_REFUSED", { reason: "shape", errorCode: "VAL-001" });
    return reply(req, 400, "VAL-001");
  }
  const { id, type } = parsed.data;
  const column = EVENT_COLUMN[type];
  try {
    const row = await prisma.checkupResponse.findUnique({ where: { id }, select: { createdAt: true } });
    if (!row || Date.now() - row.createdAt.getTime() > EVENT_WINDOW_MS) return reply(req, 404, "CHECKUP-006");
    await prisma.checkupResponse.updateMany({ where: { id, [column]: null }, data: { [column]: new Date() } });
  } catch (err) {
    log.error("CHECKUP_SAVE_FAILED", { errorCode: "DB-002", errorName: (err as Error)?.name, prismaCode: (err as { code?: string })?.code });
    return reply(req, 503, "DB-002");
  }
  log.debug("CHECKUP_EVENT_RECORDED", { type });
  return reply(req, 200);
}

const loggedPOST = withApiLogging("POST", "/api/checkup/event", POST);
export { loggedPOST as POST };
