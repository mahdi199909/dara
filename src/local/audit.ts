// On-device equivalent of src/lib/audit.ts's writeAuditLog — same fields, but there's no
// HTTP request to pull ipAddress/userAgent from on a local call, so callers just omit them.
import type { LocalDb } from "./db";
import { getLogger } from "../lib/observability";

const log = getLogger("audit", "local-writer");

interface LocalAuditParams {
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: unknown;
}

/** Writes an audit log entry locally. Never throws — logging failures must not break the primary operation. */
export function writeLocalAuditLog(db: LocalDb, params: LocalAuditParams): void {
  try {
    db.run(
      `INSERT INTO "AuditLog" ("id", "userId", "action", "entityType", "entityId", "oldValue", "newValue", "metadata", "createdAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        params.userId,
        params.action,
        params.entityType,
        params.entityId ?? null,
        params.oldValue !== undefined ? JSON.stringify(params.oldValue) : null,
        params.newValue !== undefined ? JSON.stringify(params.newValue) : null,
        params.metadata !== undefined ? JSON.stringify(params.metadata) : null,
        new Date().toISOString(),
      ]
    );
  } catch (err) {
    log.error("AUDIT_WRITE_FAILED", { error: err, errorCode: "AUDIT-001", layer: "local", entityType: params.entityType, entityId: params.entityId, operation: params.action });
  }
}
