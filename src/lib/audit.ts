import { prisma } from "./db";

interface AuditParams {
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: unknown;
}

/** Writes an audit log entry. Never throws — logging failures must not break the primary operation. */
export async function writeAuditLog(params: AuditParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        oldValue: params.oldValue !== undefined ? JSON.stringify(params.oldValue) : null,
        newValue: params.newValue !== undefined ? JSON.stringify(params.newValue) : null,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        metadata: params.metadata !== undefined ? JSON.stringify(params.metadata) : null,
      },
    });
  } catch (err) {
    console.error("Failed to write audit log", err);
  }
}

export function requestMeta(req: Request): { ipAddress: string | null; userAgent: string | null } {
  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;
  const userAgent = req.headers.get("user-agent");
  return { ipAddress, userAgent };
}
