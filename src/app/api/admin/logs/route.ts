import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { ApiError, handleApiError } from "@/lib/apiError";
import { getLogger } from "@/lib/observability";
import { emailPseudonym } from "@/lib/observability/server/authEvents";
import { buildLogMatcher, levelFilter, parseTimeInput, toTimelineEntry, type LogFilters } from "@/lib/observability/server/logSearch";
import { getServerLogSinks } from "@/lib/observability/server/serverSinks";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// The support timeline (doc/logging/debugging.md): what happened to a person, a request or a sync, oldest first, read from
// the server's rotated log files. Redacted when it was written and again on the way out; a stack trace only with
// stack=1. Reading it is itself written to the log (LOG_QUERIED) — which filters were used, never what came back.
//
//   user     an account id, or an e-mail address (its sign-in failures are found by their pseudonym)
//   request  a request id (req_…), or trace=<32 hex>       sync=<sync id>       entity=<row id>
//   level    this level and above       event=SYNC_*,AUTH_LOGIN_FAILED       module   platform   version   code=SYNC-002
//   since    an ISO time, or 15m / 2h / 3d before now (default 24h)     until   an ISO time     limit  (default 200, at most 1000)
const log = getLogger(null, "admin");

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 200;

async function GET(req: NextRequest) {
  try {
    const adminId = await requireAdmin();
    const sinks = getServerLogSinks();
    if (!sinks?.file) {
      return NextResponse.json({ available: false, reason: "The server keeps no log file (set LOG_FILE_DIR), so there is nothing to search.", records: [] });
    }

    const params = req.nextUrl.searchParams;
    const now = Date.now();
    const filters: LogFilters = {};
    let targetUserId: string | undefined;

    const person = params.get("user")?.trim();
    if (person) {
      if (person.includes("@")) {
        const email = person.toLowerCase();
        const found = await prisma.user.findUnique({ where: { email }, select: { id: true } });
        if (found) filters.userId = targetUserId = found.id;
        // A failed sign-in carries only this pseudonym, and an address that is no account still has such records to find.
        filters.emailHash = emailPseudonym(email);
      } else {
        filters.userId = targetUserId = person;
      }
    }
    const text = (name: string) => params.get(name)?.trim() || undefined;
    filters.requestId = text("request");
    filters.traceId = text("trace");
    filters.syncId = text("sync");
    filters.entityId = text("entity");
    filters.event = text("event");
    filters.module = text("module");
    filters.platform = text("platform");
    filters.version = text("version");
    filters.errorCode = text("code");

    const minLevelText = text("level");
    if (minLevelText) {
      filters.minLevel = levelFilter(minLevelText);
      if (!filters.minLevel) throw new ApiError("سطح لاگ معتبر نیست.", 400);
    }
    const sinceText = text("since") ?? "24h";
    filters.sinceMs = parseTimeInput(sinceText, now);
    if (filters.sinceMs === undefined) throw new ApiError("زمان شروع معتبر نیست (مثل ۲h یا یک تاریخ ISO).", 400);
    const untilText = text("until");
    if (untilText) {
      filters.untilMs = parseTimeInput(untilText, now);
      if (filters.untilMs === undefined) throw new ApiError("زمان پایان معتبر نیست.", 400);
    }
    const requestedLimit = Number(params.get("limit"));
    const limit = Number.isFinite(requestedLimit) && requestedLimit >= 1 ? Math.min(Math.floor(requestedLimit), MAX_LIMIT) : DEFAULT_LIMIT;
    const stack = params.get("stack") === "1";

    // What is still queued in memory is part of the recent past.
    await sinks.file.batching.flush();
    const result = await sinks.file.sink.search({ match: buildLogMatcher(filters), limit, sinceMs: filters.sinceMs });
    const records = result.records.map((record) => toTimelineEntry(record, { stack }));

    log.info("LOG_QUERIED", {
      by: adminId,
      targetUserId,
      filters: Object.keys(filters).filter((key) => filters[key as keyof LogFilters] !== undefined),
      matched: records.length,
      filesRead: result.filesRead,
    });
    return NextResponse.json(
      { available: true, records, truncated: result.truncated, filesRead: result.filesRead, recordsScanned: result.recordsScanned, targetUserId },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/admin/logs", GET);
export { loggedGET as GET };
