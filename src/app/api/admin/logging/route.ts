import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { ApiError, handleApiError } from "@/lib/apiError";
import { audit } from "@/lib/audit";
import { DOMAINS, LEVELS } from "@/lib/observability";
import {
  DEFAULT_TTL_MINUTES,
  MAX_TTL_MINUTES,
  applyLoggingChange,
  describeLogging,
  type AppliedChange,
  type LoggingChange,
  type LoggingState,
} from "@/lib/observability/server/adminLogging";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// Dynamic debugging for the owner: turn a component (SYNC, FINANCE …) or one person's requests up to DEBUG for a
// while — or quiet a noisy one — without a deployment or a restart. A verbose level always expires (30 minutes unless
// asked otherwise, 24 hours at most); every change is audited. See src/lib/observability/server/adminLogging.ts.
const level = z.preprocess((value) => (typeof value === "string" ? value.trim().toUpperCase() : value), z.enum(LEVELS));
const ttlMinutes = z.number().int().min(1).max(MAX_TTL_MINUTES).optional();
const scopeKey = z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_-]{1,39}$/, "نام محدوده معتبر نیست.");

const changeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("base"), level, ttlMinutes }),
  z.object({ kind: z.literal("scope"), key: scopeKey, level, ttlMinutes }),
  z.object({ kind: z.literal("user"), userId: z.string().trim().min(1).max(64), level, ttlMinutes }),
]);

/** The levels as a flat map, so the audit entry's diff reads "scope:SYNC: — → DEBUG" rather than a nested array. */
function flat(state: LoggingState): Record<string, string> {
  return {
    base: state.base,
    ...Object.fromEntries(state.overrides.map((rule) => [`scope:${rule.scope}`, rule.level])),
    ...Object.fromEntries(state.users.map((rule) => [`user:${rule.userId}`, rule.level])),
  };
}

async function describe() {
  return {
    state: describeLogging(),
    levels: LEVELS,
    // What LOG_LEVEL_OVERRIDES-style keys the owner is likely to want; any domain, module or component name works.
    scopes: DOMAINS,
    limits: { defaultTtlMinutes: DEFAULT_TTL_MINUTES, maxTtlMinutes: MAX_TTL_MINUTES },
  };
}

async function record(req: Request, applied: AppliedChange) {
  await audit.log({
    event: "LOG_LEVEL_ADMIN_UPDATED",
    entityType: "LogSettings",
    entityId: "runtime",
    before: flat(applied.before),
    after: flat(applied.after),
    metadata: applied.summary,
    source: "admin",
    req,
  });
}

async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(await describe(), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleApiError(err);
  }
}

async function PUT(req: NextRequest) {
  try {
    await requireAdmin();
    const body = changeSchema.parse(await req.json());
    if (body.kind === "user") {
      const exists = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } });
      if (!exists) throw new ApiError("کاربری با این شناسه پیدا نشد.", 404);
    }
    const change: LoggingChange = body.kind === "base" ? { kind: "base", level: body.level, ttlMinutes: body.ttlMinutes } : body.kind === "scope" ? { kind: "scope", key: body.key, level: body.level, ttlMinutes: body.ttlMinutes } : { kind: "user", userId: body.userId, level: body.level, ttlMinutes: body.ttlMinutes };
    const applied = applyLoggingChange(change);
    await record(req, applied);
    return NextResponse.json({ ...(await describe()), applied: applied.summary });
  } catch (err) {
    return handleApiError(err);
  }
}

// DELETE /api/admin/logging?scope=SYNC   puts that component back to what the environment configured
// DELETE /api/admin/logging?user=<id>    stops tracing that person
// DELETE /api/admin/logging?all=1        puts everything back to what the environment configured
async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();
    const params = req.nextUrl.searchParams;
    const scope = params.get("scope");
    const user = params.get("user");
    let change: LoggingChange;
    if (scope) change = { kind: "clear-scope", key: scopeKey.parse(scope) };
    else if (user) change = { kind: "clear-user", userId: z.string().trim().min(1).max(64).parse(user) };
    else if (params.get("all") === "1") change = { kind: "reset" };
    else throw new ApiError("مشخص کنید کدام تنظیم برگردانده شود (scope، user یا all=1).", 400);
    const applied = applyLoggingChange(change);
    await record(req, applied);
    return NextResponse.json({ ...(await describe()), applied: applied.summary });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/admin/logging", GET);
const loggedPUT = withApiLogging("PUT", "/api/admin/logging", PUT);
const loggedDELETE = withApiLogging("DELETE", "/api/admin/logging", DELETE);
export { loggedGET as GET, loggedPUT as PUT, loggedDELETE as DELETE };
