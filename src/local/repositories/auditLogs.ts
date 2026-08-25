// On-device port of src/app/api/audit-logs/route.ts (GET only) — filterable by entityType,
// same limit/cap semantics. No zod schema to extract: it's plain querystring parsing, handled
// inline the same way listTasks handles its filters.
import type { LocalDb } from "../db";

interface AuditLogRow {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValue: string | null;
  newValue: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: string | null;
  createdAt: string;
}

export function listAuditLogs(db: LocalDb, userId: string, filters: { entityType?: string; limit?: number } = {}) {
  const limit = Math.min(filters.limit ?? 100, 300);

  const where = [`"userId" = ?`];
  const params: unknown[] = [userId];
  if (filters.entityType) {
    where.push(`"entityType" = ?`);
    params.push(filters.entityType);
  }

  const logs = db.all<AuditLogRow>(`SELECT * FROM "AuditLog" WHERE ${where.join(" AND ")} ORDER BY "createdAt" DESC LIMIT ?`, [...params, limit]);

  return { logs };
}
