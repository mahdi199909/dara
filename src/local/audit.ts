// On-device equivalent of src/lib/audit.ts's writeAuditLog — same legacy columns, plus the canonical
// event, a field-level diff for updates, and a local event id that ties the row to its line in the
// application log (and, later, to the sync that carries the change). There's no HTTP request to pull
// ipAddress/userAgent/requestId from on a local call, so callers just omit them.
import type { LocalDb } from "./db";
import { buildAuditChanges, getLogger, newId, resolveAuditIdentity, serializeChanges, type AuditChanges } from "../lib/observability";
import { afterLocalCommit } from "./transaction";
import { getClientDeviceId } from "../lib/observability/client/clientContext";
import { SYNC_TABLES } from "../lib/syncTables";

// No fixed module: each event takes the module of its own domain (TASK_UPDATE_SUCCESS → tasks, AUDIT_WRITE_FAILED → audit).
const log = getLogger(null, "local-writer");

/** Whether a change to this kind of entity travels to the server on the next sync (so, until then, it is PENDING). */
function syncsToServer(entityType: string): boolean {
  return entityType === "Settings" || SYNC_TABLES.some((table) => table.table === entityType);
}

interface LocalAuditParams {
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: unknown;
  /** The canonical event (TASK_UPDATED); derived from (entityType, action) when omitted. */
  event?: string;
  /** A precomputed diff; otherwise one is computed when both oldValue and newValue are records. */
  changes?: AuditChanges | null;
}

/**
 * Writes an audit log entry locally. Never throws — logging failures must not break the primary operation.
 * Called inside a transaction (every write route runs in one), the entry is part of it: it is stored together
 * with the change it records, and a rollback removes both. The success line waits for the commit.
 */
export function writeLocalAuditLog(db: LocalDb, params: LocalAuditParams): void {
  const identity = resolveAuditIdentity({ action: params.action, entityType: params.entityType, event: params.event });
  const localEventId = newId("lev");
  let changes: AuditChanges | null | undefined;
  try {
    changes = params.changes !== undefined ? params.changes : buildAuditChanges(params.oldValue, params.newValue);
    db.run(
      `INSERT INTO "AuditLog" ("id", "userId", "action", "entityType", "entityId", "oldValue", "newValue", "metadata", "event", "source", "deviceId", "localEventId", "changes", "createdAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        params.userId,
        identity.action,
        identity.entityType,
        params.entityId ?? null,
        params.oldValue !== undefined ? JSON.stringify(params.oldValue) : null,
        params.newValue !== undefined ? JSON.stringify(params.newValue) : null,
        params.metadata !== undefined ? JSON.stringify(params.metadata) : null,
        identity.event,
        "local",
        getClientDeviceId() ?? null,
        localEventId,
        serializeChanges(changes),
        new Date().toISOString(),
      ]
    );
  } catch (err) {
    log.error("AUDIT_WRITE_FAILED", { error: err, errorCode: "AUDIT-001", layer: "local", entityType: params.entityType, entityId: params.entityId, operation: params.action });
  }
  // Success is logged once the change has committed (at once, when no transaction is open) — whether or not the audit row could be stored.
  const logEvent = identity.logEvent;
  if (logEvent) {
    afterLocalCommit(db, () =>
      log.info(logEvent, {
        entityType: identity.entityType,
        entityId: params.entityId,
        operation: identity.action,
        localEventId,
        // The change is in this phone's database and reaches the server with the next sync: until then it is pending.
        syncStatus: syncsToServer(identity.entityType) ? "PENDING" : undefined,
        changedFields: changes?.changedFields,
        layer: "local",
      })
    );
  }
}
