import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { EDIT_WINDOW_MS, deriveColumns, normalizeAnswers, sanitizeSource, sourceGroup, submissionSchema } from "@/lib/checkup";
import { BodyTooLargeError, dailyCap, hashIp, ipBucket, readCappedText } from "@/lib/checkupServer";
import { clientIp } from "@/lib/clientIp";
import { isAllowedOrigin, publicPreflight, withPublicCors } from "@/lib/publicCors";
import { LIMITS, checkRateLimit } from "@/lib/rateLimit";
import { getLogger, type ErrorCode } from "@/lib/observability";
import { setRequestErrorCode } from "@/lib/observability/server/requestContext";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// The public research form on parvaapp.ir/checkup saves its answers here, page by page — no session (see
// PUBLIC_API_PATHS in src/middleware.ts). Write-only by design: every answer is `{ ok }` or `{ ok, code }`,
// nothing stored is ever sent back, and a refusal never says which field was wrong. What guards it:
// the Origin must be the site's own (publicCors.ts), a body is at most 16 KB, the shape is strict (zod),
// a filled hidden field is answered but not stored, a completed or 3-hour-old sheet no longer changes,
// two per-address limits and one daily ceiling for the whole server (so a flood can never fill the disk
// the app itself runs on). The log never carries an answer, a contact or an address.
const log = getLogger("checkup", "api");

export async function OPTIONS(req: Request) {
  return publicPreflight(req);
}

function reply(req: Request, status: number, code?: ErrorCode, headers: Record<string, string> = {}): Response {
  if (code) setRequestErrorCode(code);
  const body = code ? { ok: false, code } : { ok: true };
  return withPublicCors(req, NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } }));
}

let lastCapWarning = 0;

async function POST(req: Request) {
  if (!isAllowedOrigin(req.headers.get("origin"))) {
    log.warn("CHECKUP_REFUSED", { reason: "origin", errorCode: "CHECKUP-004" });
    return reply(req, 403, "CHECKUP-004");
  }
  const bucket = ipBucket(clientIp(req)) ?? "unknown";
  const write = checkRateLimit(`checkup-write:${bucket}`, LIMITS.checkupWritePerIp);
  if (!write.allowed) {
    log.warn("CHECKUP_RATE_LIMITED", { limit: "write", errorCode: "CHECKUP-002" });
    return reply(req, 429, "CHECKUP-002", { "Retry-After": String(Math.ceil(write.retryAfterMs / 1000)) });
  }

  let text: string;
  try {
    text = await readCappedText(req);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      log.warn("CHECKUP_REFUSED", { reason: "too_large", errorCode: "CHECKUP-005" });
      return reply(req, 413, "CHECKUP-005");
    }
    throw err;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  const parsed = submissionSchema.safeParse(json);
  if (!parsed.success) {
    log.warn("CHECKUP_REFUSED", { reason: "shape", errorCode: "VAL-001" });
    return reply(req, 400, "VAL-001");
  }
  const body = parsed.data;
  if (body.hp && body.hp.trim()) {
    log.info("CHECKUP_HONEYPOT", {});
    return reply(req, 200);
  }

  const answers = normalizeAnswers(body.answers);
  const data = {
    ...deriveColumns(answers),
    answersJson: JSON.stringify(answers),
    durationSec: body.durationSec ?? null,
    completedAt: body.completed ? new Date() : null,
  };
  const page = body.completed ? 5 : body.page;

  try {
    const existing = await prisma.checkupResponse.findUnique({ where: { id: body.id }, select: { createdAt: true, completedAt: true, lastPage: true } });
    if (existing) {
      if (existing.completedAt || Date.now() - existing.createdAt.getTime() > EDIT_WINDOW_MS) {
        log.debug("CHECKUP_LOCKED", { errorCode: "CHECKUP-001" });
        return reply(req, 409, "CHECKUP-001");
      }
      await prisma.checkupResponse.update({ where: { id: body.id }, data: { ...data, lastPage: Math.max(existing.lastPage, page) } });
    } else {
      const fresh = checkRateLimit(`checkup-new:${bucket}`, LIMITS.checkupNewPerIp);
      if (!fresh.allowed) {
        log.warn("CHECKUP_RATE_LIMITED", { limit: "new", errorCode: "CHECKUP-002" });
        return reply(req, 429, "CHECKUP-002", { "Retry-After": String(Math.ceil(fresh.retryAfterMs / 1000)) });
      }
      const lastDay = await prisma.checkupResponse.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
      if (lastDay >= dailyCap()) {
        if (Date.now() - lastCapWarning > 10 * 60 * 1000) {
          lastCapWarning = Date.now();
          log.warn("CHECKUP_DAILY_CAP_REACHED", { cap: dailyCap(), errorCode: "CHECKUP-003" });
        }
        return reply(req, 429, "CHECKUP-003", { "Retry-After": "3600" });
      }
      const source = sanitizeSource(body.source);
      try {
        await prisma.checkupResponse.create({
          data: { id: body.id, ...data, lastPage: page, source, sourceGroup: sourceGroup(source), ipHash: hashIp(bucket === "unknown" ? null : bucket) },
        });
      } catch (err) {
        // Two saves of a brand-new sheet raced (a retry from the queue): the other one created it.
        if ((err as { code?: string }).code !== "P2002") throw err;
        await prisma.checkupResponse.update({ where: { id: body.id }, data: { ...data, lastPage: page } });
      }
    }
  } catch (err) {
    // Only the error's kind: a Prisma message can quote the values it was given.
    log.error("CHECKUP_SAVE_FAILED", { errorCode: "DB-002", errorName: (err as Error)?.name, prismaCode: (err as { code?: string })?.code });
    return reply(req, 503, "DB-002");
  }

  if (body.completed) log.info("CHECKUP_COMPLETED", {});
  else log.debug("CHECKUP_SAVED", { page });
  return reply(req, 200);
}

const loggedPOST = withApiLogging("POST", "/api/checkup", POST);
export { loggedPOST as POST };
