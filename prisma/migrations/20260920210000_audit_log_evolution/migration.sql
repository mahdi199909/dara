-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "changes" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "deviceId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "event" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "localEventId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "requestId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "source" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "traceId" TEXT;
