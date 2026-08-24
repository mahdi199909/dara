-- AlterTable
ALTER TABLE "Project" ADD COLUMN "completedAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT NOT NULL DEFAULT '#3a8d80',
    "kind" TEXT NOT NULL DEFAULT 'NEUTRAL',
    "valueType" TEXT NOT NULL DEFAULT 'EXPENSE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "generatesVirtualAsset" BOOLEAN NOT NULL DEFAULT false,
    "virtualAssetValuePerHour" INTEGER,
    "projectId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Category_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Category_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Category" ("color", "createdAt", "deletedAt", "generatesVirtualAsset", "icon", "id", "isActive", "kind", "name", "updatedAt", "userId", "valueType", "virtualAssetValuePerHour") SELECT "color", "createdAt", "deletedAt", "generatesVirtualAsset", "icon", "id", "isActive", "kind", "name", "updatedAt", "userId", "valueType", "virtualAssetValuePerHour" FROM "Category";
DROP TABLE "Category";
ALTER TABLE "new_Category" RENAME TO "Category";
CREATE UNIQUE INDEX "Category_projectId_key" ON "Category"("projectId");
CREATE INDEX "Category_userId_idx" ON "Category"("userId");
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
    "directCost" INTEGER NOT NULL DEFAULT 0,
    "incomeAmount" INTEGER NOT NULL DEFAULT 0,
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
INSERT INTO "new_Event" ("allDay", "categoryId", "createdAt", "deletedAt", "description", "directCost", "endAt", "id", "isCancelled", "location", "projectId", "recurrenceFreq", "recurrenceInterval", "recurrenceParentId", "recurrenceUntil", "startAt", "title", "updatedAt", "userId", "valueType") SELECT "allDay", "categoryId", "createdAt", "deletedAt", "description", "directCost", "endAt", "id", "isCancelled", "location", "projectId", "recurrenceFreq", "recurrenceInterval", "recurrenceParentId", "recurrenceUntil", "startAt", "title", "updatedAt", "userId", "valueType" FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
CREATE INDEX "Event_userId_idx" ON "Event"("userId");
CREATE INDEX "Event_startAt_idx" ON "Event"("startAt");
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "dueDate" DATETIME,
    "categoryId" TEXT,
    "projectId" TEXT,
    "estimatedCost" INTEGER,
    "completedAt" DATETIME,
    "valueType" TEXT NOT NULL DEFAULT 'EXPENSE',
    "directCost" INTEGER NOT NULL DEFAULT 0,
    "incomeAmount" INTEGER NOT NULL DEFAULT 0,
    "startAt" DATETIME,
    "endAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("categoryId", "completedAt", "createdAt", "deletedAt", "description", "directCost", "dueDate", "endAt", "estimatedCost", "id", "projectId", "startAt", "status", "title", "updatedAt", "userId", "valueType") SELECT "categoryId", "completedAt", "createdAt", "deletedAt", "description", "directCost", "dueDate", "endAt", "estimatedCost", "id", "projectId", "startAt", "status", "title", "updatedAt", "userId", "valueType" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_userId_idx" ON "Task"("userId");
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");
CREATE INDEX "Task_status_idx" ON "Task"("status");
CREATE TABLE "new_VirtualAssetEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "activityId" TEXT,
    "taskId" TEXT,
    "projectId" TEXT,
    "categoryId" TEXT,
    "durationMin" INTEGER NOT NULL,
    "valuePerHour" INTEGER NOT NULL,
    "totalValue" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VirtualAssetEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VirtualAssetEntry_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VirtualAssetEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VirtualAssetEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VirtualAssetEntry" ("activityId", "categoryId", "createdAt", "date", "durationMin", "id", "taskId", "totalValue", "userId", "valuePerHour") SELECT "activityId", "categoryId", "createdAt", "date", "durationMin", "id", "taskId", "totalValue", "userId", "valuePerHour" FROM "VirtualAssetEntry";
DROP TABLE "VirtualAssetEntry";
ALTER TABLE "new_VirtualAssetEntry" RENAME TO "VirtualAssetEntry";
CREATE UNIQUE INDEX "VirtualAssetEntry_activityId_key" ON "VirtualAssetEntry"("activityId");
CREATE UNIQUE INDEX "VirtualAssetEntry_taskId_key" ON "VirtualAssetEntry"("taskId");
CREATE UNIQUE INDEX "VirtualAssetEntry_projectId_key" ON "VirtualAssetEntry"("projectId");
CREATE INDEX "VirtualAssetEntry_userId_idx" ON "VirtualAssetEntry"("userId");
CREATE INDEX "VirtualAssetEntry_date_idx" ON "VirtualAssetEntry"("date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
