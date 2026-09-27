-- @local:skip
-- Owner-edited server settings (encrypted), e.g. the email/SMS keys. Server only; not replayed on the phone.

-- CreateTable
CREATE TABLE "ServerSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL
);
