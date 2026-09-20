-- @local:skip
-- Money columns Int -> Float (see the note at the top of prisma/schema.prisma). Applies to the
-- server-side / dev SQLite databases that Prisma manages. It is deliberately NOT replayed on
-- the phone (scripts/generate-local-schema.ts honors the marker on the first line): SQLite
-- columns are dynamically typed, so an INTEGER column already holds any whole number the phone
-- can produce, and rewriting 14 tables full of a user's only copy of their data just to change a
-- type affinity nothing reads would be all risk and no benefit.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Activity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "categoryId" TEXT,
    "taskId" TEXT,
    "projectId" TEXT,
    "totalDurationMin" INTEGER NOT NULL DEFAULT 0,
    "directCost" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Activity_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Activity_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Activity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Activity" ("categoryId", "createdAt", "deletedAt", "directCost", "id", "notes", "projectId", "taskId", "title", "totalDurationMin", "updatedAt", "userId") SELECT "categoryId", "createdAt", "deletedAt", "directCost", "id", "notes", "projectId", "taskId", "title", "totalDurationMin", "updatedAt", "userId" FROM "Activity";
DROP TABLE "Activity";
ALTER TABLE "new_Activity" RENAME TO "Activity";
CREATE INDEX "Activity_userId_idx" ON "Activity"("userId");
CREATE INDEX "Activity_categoryId_idx" ON "Activity"("categoryId");
CREATE INDEX "Activity_projectId_idx" ON "Activity"("projectId");
CREATE INDEX "Activity_taskId_idx" ON "Activity"("taskId");
CREATE TABLE "new_Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "purchasePrice" REAL NOT NULL,
    "purchaseDate" DATETIME NOT NULL,
    "currentValue" REAL NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Asset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Asset" ("category", "createdAt", "currentValue", "deletedAt", "id", "name", "notes", "purchaseDate", "purchasePrice", "updatedAt", "userId") SELECT "category", "createdAt", "currentValue", "deletedAt", "id", "name", "notes", "purchaseDate", "purchasePrice", "updatedAt", "userId" FROM "Asset";
DROP TABLE "Asset";
ALTER TABLE "new_Asset" RENAME TO "Asset";
CREATE INDEX "Asset_userId_idx" ON "Asset"("userId");
CREATE TABLE "new_AssetTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "date" DATETIME NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssetTransaction_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AssetTransaction" ("amount", "assetId", "createdAt", "date", "id", "notes", "type") SELECT "amount", "assetId", "createdAt", "date", "id", "notes", "type" FROM "AssetTransaction";
DROP TABLE "AssetTransaction";
ALTER TABLE "new_AssetTransaction" RENAME TO "AssetTransaction";
CREATE INDEX "AssetTransaction_assetId_idx" ON "AssetTransaction"("assetId");
CREATE TABLE "new_CapitalSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "investedMinutes" INTEGER NOT NULL,
    "virtualAssetValue" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CapitalSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CapitalSnapshot" ("createdAt", "date", "id", "investedMinutes", "userId", "virtualAssetValue") SELECT "createdAt", "date", "id", "investedMinutes", "userId", "virtualAssetValue" FROM "CapitalSnapshot";
DROP TABLE "CapitalSnapshot";
ALTER TABLE "new_CapitalSnapshot" RENAME TO "CapitalSnapshot";
CREATE INDEX "CapitalSnapshot_userId_idx" ON "CapitalSnapshot"("userId");
CREATE UNIQUE INDEX "CapitalSnapshot_userId_date_key" ON "CapitalSnapshot"("userId", "date");
CREATE TABLE "new_Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT NOT NULL DEFAULT '#3a8d80',
    "kind" TEXT NOT NULL DEFAULT 'NEUTRAL',
    "valueType" TEXT NOT NULL DEFAULT 'EXPENSE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "generatesVirtualAsset" BOOLEAN NOT NULL DEFAULT false,
    "virtualAssetValuePerHour" REAL,
    "projectId" TEXT,
    "parentCategoryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Category_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Category_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Category_parentCategoryId_fkey" FOREIGN KEY ("parentCategoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Category" ("color", "createdAt", "deletedAt", "generatesVirtualAsset", "icon", "id", "isActive", "kind", "name", "parentCategoryId", "projectId", "sortOrder", "updatedAt", "userId", "valueType", "virtualAssetValuePerHour") SELECT "color", "createdAt", "deletedAt", "generatesVirtualAsset", "icon", "id", "isActive", "kind", "name", "parentCategoryId", "projectId", "sortOrder", "updatedAt", "userId", "valueType", "virtualAssetValuePerHour" FROM "Category";
DROP TABLE "Category";
ALTER TABLE "new_Category" RENAME TO "Category";
CREATE UNIQUE INDEX "Category_projectId_key" ON "Category"("projectId");
CREATE INDEX "Category_userId_idx" ON "Category"("userId");
CREATE INDEX "Category_parentCategoryId_idx" ON "Category"("parentCategoryId");
CREATE TABLE "new_Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "categoryId" TEXT,
    "projectId" TEXT,
    "valueType" TEXT NOT NULL DEFAULT 'EXPENSE',
    "directCost" REAL NOT NULL DEFAULT 0,
    "incomeAmount" REAL NOT NULL DEFAULT 0,
    "recurrenceFreq" TEXT NOT NULL DEFAULT 'NONE',
    "recurrenceInterval" INTEGER NOT NULL DEFAULT 1,
    "recurrenceUntil" DATETIME,
    "recurrenceCount" INTEGER,
    "recurrenceParentId" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Event_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Event_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Event_recurrenceParentId_fkey" FOREIGN KEY ("recurrenceParentId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Event" ("allDay", "categoryId", "createdAt", "deletedAt", "description", "directCost", "endAt", "id", "incomeAmount", "isCancelled", "location", "projectId", "recurrenceCount", "recurrenceFreq", "recurrenceInterval", "recurrenceParentId", "recurrenceUntil", "startAt", "title", "updatedAt", "userId", "valueType") SELECT "allDay", "categoryId", "createdAt", "deletedAt", "description", "directCost", "endAt", "id", "incomeAmount", "isCancelled", "location", "projectId", "recurrenceCount", "recurrenceFreq", "recurrenceInterval", "recurrenceParentId", "recurrenceUntil", "startAt", "title", "updatedAt", "userId", "valueType" FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
CREATE INDEX "Event_userId_idx" ON "Event"("userId");
CREATE INDEX "Event_startAt_idx" ON "Event"("startAt");
CREATE TABLE "new_FinanceAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'BANK_ACCOUNT',
    "initialBalance" REAL NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "FinanceAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_FinanceAccount" ("createdAt", "deletedAt", "id", "initialBalance", "isActive", "name", "type", "updatedAt", "userId") SELECT "createdAt", "deletedAt", "id", "initialBalance", "isActive", "name", "type", "updatedAt", "userId" FROM "FinanceAccount";
DROP TABLE "FinanceAccount";
ALTER TABLE "new_FinanceAccount" RENAME TO "FinanceAccount";
CREATE INDEX "FinanceAccount_userId_idx" ON "FinanceAccount"("userId");
CREATE TABLE "new_Habit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT NOT NULL DEFAULT '#3a8d80',
    "categoryId" TEXT,
    "virtualAssetValuePerCheckIn" REAL NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastNudgeSentAt" DATETIME,
    "isTrial" BOOLEAN NOT NULL DEFAULT false,
    "cue" TEXT,
    "celebration" TEXT,
    "trialStartDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Habit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Habit_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Habit" ("categoryId", "celebration", "color", "createdAt", "cue", "deletedAt", "description", "icon", "id", "isActive", "isTrial", "lastNudgeSentAt", "title", "trialStartDate", "updatedAt", "userId", "virtualAssetValuePerCheckIn") SELECT "categoryId", "celebration", "color", "createdAt", "cue", "deletedAt", "description", "icon", "id", "isActive", "isTrial", "lastNudgeSentAt", "title", "trialStartDate", "updatedAt", "userId", "virtualAssetValuePerCheckIn" FROM "Habit";
DROP TABLE "Habit";
ALTER TABLE "new_Habit" RENAME TO "Habit";
CREATE INDEX "Habit_userId_idx" ON "Habit"("userId");
CREATE TABLE "new_Installment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "amount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Installment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "InstallmentPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Installment" ("amount", "createdAt", "dueDate", "id", "index", "paidAt", "planId", "status", "updatedAt") SELECT "amount", "createdAt", "dueDate", "id", "index", "paidAt", "planId", "status", "updatedAt" FROM "Installment";
DROP TABLE "Installment";
ALTER TABLE "new_Installment" RENAME TO "Installment";
CREATE INDEX "Installment_planId_idx" ON "Installment"("planId");
CREATE INDEX "Installment_dueDate_idx" ON "Installment"("dueDate");
CREATE INDEX "Installment_status_idx" ON "Installment"("status");
CREATE TABLE "new_InstallmentPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "totalAmount" REAL NOT NULL,
    "installmentAmount" REAL NOT NULL,
    "numberOfInstallments" INTEGER NOT NULL,
    "dueDay" INTEGER NOT NULL,
    "startDate" DATETIME NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "InstallmentPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_InstallmentPlan" ("createdAt", "deletedAt", "dueDay", "id", "installmentAmount", "notes", "numberOfInstallments", "startDate", "title", "totalAmount", "updatedAt", "userId") SELECT "createdAt", "deletedAt", "dueDay", "id", "installmentAmount", "notes", "numberOfInstallments", "startDate", "title", "totalAmount", "updatedAt", "userId" FROM "InstallmentPlan";
DROP TABLE "InstallmentPlan";
ALTER TABLE "new_InstallmentPlan" RENAME TO "InstallmentPlan";
CREATE INDEX "InstallmentPlan_userId_idx" ON "InstallmentPlan"("userId");
CREATE TABLE "new_Settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tehran',
    "currency" TEXT NOT NULL DEFAULT 'IRT',
    "currencyDisplayUnit" TEXT NOT NULL DEFAULT 'TOMAN',
    "calendarType" TEXT NOT NULL DEFAULT 'jalali',
    "monthlyIncome" REAL,
    "workingHoursMonth" INTEGER,
    "hourlyValueOverride" REAL,
    "dashboardCardPrefs" TEXT,
    "dailyQuoteEnabled" BOOLEAN NOT NULL DEFAULT true,
    "wakeHour" INTEGER NOT NULL DEFAULT 7,
    "sleepHour" INTEGER NOT NULL DEFAULT 23,
    "dailyProductiveTargetMin" INTEGER NOT NULL DEFAULT 360,
    "companionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "calendarFeaturedType" TEXT,
    "calendarFeaturedId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Settings" ("calendarFeaturedId", "calendarFeaturedType", "calendarType", "companionEnabled", "createdAt", "currency", "currencyDisplayUnit", "dailyProductiveTargetMin", "dailyQuoteEnabled", "dashboardCardPrefs", "hourlyValueOverride", "id", "monthlyIncome", "sleepHour", "theme", "timezone", "updatedAt", "userId", "wakeHour", "workingHoursMonth") SELECT "calendarFeaturedId", "calendarFeaturedType", "calendarType", "companionEnabled", "createdAt", "currency", "currencyDisplayUnit", "dailyProductiveTargetMin", "dailyQuoteEnabled", "dashboardCardPrefs", "hourlyValueOverride", "id", "monthlyIncome", "sleepHour", "theme", "timezone", "updatedAt", "userId", "wakeHour", "workingHoursMonth" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
CREATE UNIQUE INDEX "Settings_userId_key" ON "Settings"("userId");
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "dueDate" DATETIME,
    "categoryId" TEXT,
    "projectId" TEXT,
    "estimatedCost" REAL,
    "completedAt" DATETIME,
    "valueType" TEXT NOT NULL DEFAULT 'EXPENSE',
    "directCost" REAL NOT NULL DEFAULT 0,
    "incomeAmount" REAL NOT NULL DEFAULT 0,
    "startAt" DATETIME,
    "endAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("categoryId", "completedAt", "createdAt", "deletedAt", "description", "directCost", "dueDate", "endAt", "estimatedCost", "id", "incomeAmount", "projectId", "startAt", "status", "title", "updatedAt", "userId", "valueType") SELECT "categoryId", "completedAt", "createdAt", "deletedAt", "description", "directCost", "dueDate", "endAt", "estimatedCost", "id", "incomeAmount", "projectId", "startAt", "status", "title", "updatedAt", "userId", "valueType" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_userId_idx" ON "Task"("userId");
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");
CREATE INDEX "Task_status_idx" ON "Task"("status");
CREATE TABLE "new_Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "date" DATETIME NOT NULL,
    "description" TEXT,
    "accountId" TEXT NOT NULL,
    "transferToAccountId" TEXT,
    "categoryId" TEXT,
    "taskId" TEXT,
    "projectId" TEXT,
    "assetId" TEXT,
    "activityId" TEXT,
    "eventId" TEXT,
    "installmentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinanceAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_transferToAccountId_fkey" FOREIGN KEY ("transferToAccountId") REFERENCES "FinanceAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "Installment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("accountId", "activityId", "amount", "assetId", "categoryId", "createdAt", "date", "deletedAt", "description", "eventId", "id", "installmentId", "projectId", "taskId", "transferToAccountId", "type", "updatedAt", "userId") SELECT "accountId", "activityId", "amount", "assetId", "categoryId", "createdAt", "date", "deletedAt", "description", "eventId", "id", "installmentId", "projectId", "taskId", "transferToAccountId", "type", "updatedAt", "userId" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE UNIQUE INDEX "Transaction_installmentId_key" ON "Transaction"("installmentId");
CREATE INDEX "Transaction_userId_idx" ON "Transaction"("userId");
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");
CREATE INDEX "Transaction_accountId_idx" ON "Transaction"("accountId");
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");
CREATE TABLE "new_VirtualAssetEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "activityId" TEXT,
    "taskId" TEXT,
    "projectId" TEXT,
    "habitCheckInId" TEXT,
    "categoryId" TEXT,
    "durationMin" INTEGER NOT NULL,
    "valuePerHour" REAL NOT NULL,
    "totalValue" REAL NOT NULL,
    "date" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VirtualAssetEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VirtualAssetEntry_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VirtualAssetEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VirtualAssetEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VirtualAssetEntry_habitCheckInId_fkey" FOREIGN KEY ("habitCheckInId") REFERENCES "HabitCheckIn" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VirtualAssetEntry" ("activityId", "categoryId", "createdAt", "date", "durationMin", "habitCheckInId", "id", "projectId", "taskId", "totalValue", "updatedAt", "userId", "valuePerHour") SELECT "activityId", "categoryId", "createdAt", "date", "durationMin", "habitCheckInId", "id", "projectId", "taskId", "totalValue", "updatedAt", "userId", "valuePerHour" FROM "VirtualAssetEntry";
DROP TABLE "VirtualAssetEntry";
ALTER TABLE "new_VirtualAssetEntry" RENAME TO "VirtualAssetEntry";
CREATE UNIQUE INDEX "VirtualAssetEntry_activityId_key" ON "VirtualAssetEntry"("activityId");
CREATE UNIQUE INDEX "VirtualAssetEntry_taskId_key" ON "VirtualAssetEntry"("taskId");
CREATE UNIQUE INDEX "VirtualAssetEntry_projectId_key" ON "VirtualAssetEntry"("projectId");
CREATE UNIQUE INDEX "VirtualAssetEntry_habitCheckInId_key" ON "VirtualAssetEntry"("habitCheckInId");
CREATE INDEX "VirtualAssetEntry_userId_idx" ON "VirtualAssetEntry"("userId");
CREATE INDEX "VirtualAssetEntry_date_idx" ON "VirtualAssetEntry"("date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

