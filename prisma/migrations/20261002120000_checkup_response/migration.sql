-- @local:skip
-- Answers to the public «حسابرسی ۵ دقیقه‌ای» research form (parvaapp.ir/checkup). Server only: never replayed on the phone
-- and never synced. Production gets the table from `prisma db push` at container start (see Dockerfile).

-- CreateTable
CREATE TABLE "CheckupResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "lastPage" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'direct',
    "sourceGroup" TEXT NOT NULL DEFAULT 'unknown',
    "durationSec" INTEGER,
    "ipHash" TEXT,
    "awakeMinutes" INTEGER,
    "namedMinutes" INTEGER,
    "hiddenMinutes" INTEGER,
    "restOfDayForgot" BOOLEAN NOT NULL DEFAULT false,
    "hourlyValue" REAL,
    "hourlyNeverThought" BOOLEAN NOT NULL DEFAULT false,
    "monthSpendAnswer" TEXT,
    "toolsUsed" TEXT,
    "toolLastOpened" TEXT,
    "paidBefore" TEXT,
    "builtHoursKnown" TEXT,
    "lastEmptyMonth" TEXT,
    "incomeShape" TEXT,
    "dependents" TEXT,
    "age" INTEGER,
    "city" TEXT,
    "contactTelegram" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "interviewOk" BOOLEAN,
    "reportViewedAt" DATETIME,
    "sharedAt" DATETIME,
    "downloadedAt" DATETIME,
    "inviteTelegramAt" DATETIME,
    "inviteAppAt" DATETIME,
    "answersJson" TEXT NOT NULL DEFAULT '{}'
);

-- CreateIndex
CREATE INDEX "CheckupResponse_createdAt_idx" ON "CheckupResponse"("createdAt");

-- CreateIndex
CREATE INDEX "CheckupResponse_sourceGroup_idx" ON "CheckupResponse"("sourceGroup");

