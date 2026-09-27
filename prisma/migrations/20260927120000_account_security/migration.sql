-- @local:skip
-- Account security: verified email/phone, one-time codes, revocable sessions, suspension. Server-only:
-- the phone keeps its own single local user and never reads these columns, so this is not replayed there.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "phone" TEXT;
ALTER TABLE "User" ADD COLUMN "phoneVerifiedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "lastLoginAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "lastSeenAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "disabledAt" DATETIME;

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateTable
CREATE TABLE "VerificationCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "purpose" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "ipAddress" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VerificationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "VerificationCode_target_purpose_createdAt_idx" ON "VerificationCode"("target", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationCode_userId_idx" ON "VerificationCode"("userId");
