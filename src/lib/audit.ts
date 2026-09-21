// The server's audit trail — the person's own history of what changed (Settings → History), kept in the
// AuditLog table for years and independent of the application log. See doc/logging/audit.md.
//
// writeAuditLog is what every route calls after its write has committed. It stores the same legacy
// columns it always did (so History keeps working) and, on top, the canonical event, the request it came
// from, and — for updates — a field-level diff. It is also where the operation's own success is put into
// the application log: at this point the write is committed, so "success" is never logged early.
import {
  buildAuditChanges,
  getLogger,
  maskMoneyInSnapshot,
  parseAuditMoneyMode,
  resolveAuditIdentity,
  serializeChanges,
  type AuditChanges,
  type ErrorCode,
  type ResolvedAuditIdentity,
} from "./observability";
import { getRequestContext } from "./observability/server/requestContext";
import { afterCommit, inTransaction } from "./observability/server/transactionContext";
import { prisma } from "./db";

// No fixed module: each event takes the module of its own domain (TASK_UPDATE_SUCCESS → tasks, AUDIT_WRITE_FAILED → audit).
const log = getLogger(null, "writer");

/** Where a write came from. */
export type AuditSource = "api" | "admin";

interface AuditParams {
  userId: string;
  /** The legacy action History labels (CREATE, UPDATE, COMPLETE_TASK …). */
  action: string;
  entityType: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: unknown;
  /** The canonical event (TASK_UPDATED); derived from (entityType, action) when omitted. */
  event?: string;
  /** A precomputed diff; otherwise one is computed when both oldValue and newValue are records. */
  changes?: AuditChanges | null;
  /** Default "api". */
  source?: AuditSource;
}

/** The operation committed before this was called, so its success goes to the application log now, whether or not the audit row could be written. */
function reportOperationSuccess(identity: ResolvedAuditIdentity, params: AuditParams, auditId: string | undefined, changes: AuditChanges | null | undefined): void {
  if (!identity.logEvent) return;
  log.info(identity.logEvent, {
    entityType: identity.entityType,
    entityId: params.entityId,
    operation: identity.action,
    auditId,
    changedFields: changes?.changedFields,
    layer: "server",
  });
}

/**
 * Writes an audit log entry. Never throws — logging failures must not break the primary operation.
 *
 * Called inside a withTransaction callback, the entry (and the operation's success line) is queued and
 * written only once that transaction has committed; if it rolls back, neither is ever written — the
 * history and the log never claim something that did not happen.
 */
export async function writeAuditLog(params: AuditParams): Promise<void> {
  if (inTransaction()) {
    afterCommit(() => writeAuditLog(params));
    return;
  }
  const identity = resolveAuditIdentity({ action: params.action, entityType: params.entityType, event: params.event });
  let auditId: string | undefined;
  let changes: AuditChanges | null | undefined;
  try {
    const context = getRequestContext();
    const mode = parseAuditMoneyMode(process.env.AUDIT_MONEY_MODE);
    changes = params.changes !== undefined ? params.changes : buildAuditChanges(params.oldValue, params.newValue, mode);
    const row = await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: identity.action,
        entityType: identity.entityType,
        entityId: params.entityId,
        oldValue: params.oldValue !== undefined ? JSON.stringify(maskMoneyInSnapshot(params.oldValue, mode)) : null,
        newValue: params.newValue !== undefined ? JSON.stringify(maskMoneyInSnapshot(params.newValue, mode)) : null,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        metadata: params.metadata !== undefined ? JSON.stringify(params.metadata) : null,
        event: identity.event,
        source: params.source ?? "api",
        requestId: context?.requestId ?? null,
        traceId: context?.traceId ?? null,
        deviceId: context?.deviceId ?? null,
        changes: serializeChanges(changes),
      },
    });
    auditId = row?.id;
  } catch (err) {
    log.error("AUDIT_WRITE_FAILED", { error: err, errorCode: "AUDIT-001", layer: "server", entityType: params.entityType, entityId: params.entityId, operation: params.action });
  }
  reportOperationSuccess(identity, params, auditId, changes);
}

export interface AuditLogInput {
  /** The canonical event ("EXPENSE_UPDATED") — or, for older callers, the legacy action ("UPDATE"). */
  event?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  /** Default: the signed-in user of the request being handled. */
  userId?: string;
  before?: unknown;
  after?: unknown;
  changes?: AuditChanges | null;
  metadata?: unknown;
  /** Supplies the caller's IP address and user agent. */
  req?: Request;
  source?: AuditSource;
}

/**
 * The developer-facing way to record an audit entry:
 *
 *   await audit.log({ event: "CATEGORIES_REORDERED", entityType: "Category", metadata: { count } });
 *   await audit.log({ event: "TASK_UPDATED", entityType: "Task", entityId, before, after, req });
 *
 * User, request id, trace id and device come from the request context; the diff is computed from
 * before/after. Never throws. (writeAuditLog, which the existing call sites use, does the same work.)
 */
export const audit = {
  async log(input: AuditLogInput): Promise<void> {
    const userId = input.userId ?? getRequestContext()?.userId;
    if (!userId) {
      log.error("AUDIT_WRITE_FAILED", { errorCode: "AUDIT-001" satisfies ErrorCode, layer: "server", reason: "no signed-in user in this context", entityType: input.entityType, entityId: input.entityId, operation: input.event ?? input.action });
      return;
    }
    const meta = input.req ? requestMeta(input.req) : { ipAddress: null, userAgent: null };
    const identity = resolveAuditIdentity({ action: input.action, event: input.event, entityType: input.entityType });
    await writeAuditLog({
      userId,
      action: identity.action,
      event: identity.event,
      entityType: identity.entityType,
      entityId: input.entityId,
      oldValue: input.before,
      newValue: input.after,
      changes: input.changes,
      metadata: input.metadata,
      source: input.source,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  },
};

export function requestMeta(req: Request): { ipAddress: string | null; userAgent: string | null } {
  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;
  const userAgent = req.headers.get("user-agent");
  return { ipAddress, userAgent };
}
