-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_HabitCheckIn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "habitId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "durationMin" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HabitCheckIn_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_HabitCheckIn" ("createdAt", "date", "durationMin", "habitId", "id", "updatedAt") SELECT "createdAt", "date", "durationMin", "habitId", "id", "updatedAt" FROM "HabitCheckIn";
DROP TABLE "HabitCheckIn";
ALTER TABLE "new_HabitCheckIn" RENAME TO "HabitCheckIn";
CREATE INDEX "HabitCheckIn_habitId_idx" ON "HabitCheckIn"("habitId");
CREATE UNIQUE INDEX "HabitCheckIn_habitId_date_key" ON "HabitCheckIn"("habitId", "date");
CREATE TABLE "new_Settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tehran',
    "currency" TEXT NOT NULL DEFAULT 'IRT',
    "currencyDisplayUnit" TEXT NOT NULL DEFAULT 'TOMAN',
    "calendarType" TEXT NOT NULL DEFAULT 'jalali',
    "monthlyIncome" INTEGER,
    "workingHoursMonth" INTEGER,
    "hourlyValueOverride" INTEGER,
    "dashboardCardPrefs" TEXT,
    "dailyQuoteEnabled" BOOLEAN NOT NULL DEFAULT true,
    "wakeHour" INTEGER NOT NULL DEFAULT 7,
    "sleepHour" INTEGER NOT NULL DEFAULT 23,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Settings" ("calendarType", "createdAt", "currency", "currencyDisplayUnit", "dailyQuoteEnabled", "dashboardCardPrefs", "hourlyValueOverride", "id", "monthlyIncome", "timezone", "updatedAt", "userId", "workingHoursMonth") SELECT "calendarType", "createdAt", "currency", "currencyDisplayUnit", "dailyQuoteEnabled", "dashboardCardPrefs", "hourlyValueOverride", "id", "monthlyIncome", "timezone", "updatedAt", "userId", "workingHoursMonth" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
CREATE UNIQUE INDEX "Settings_userId_key" ON "Settings"("userId");
CREATE TABLE "new_VirtualAssetEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "activityId" TEXT,
    "taskId" TEXT,
    "projectId" TEXT,
    "habitCheckInId" TEXT,
    "categoryId" TEXT,
    "durationMin" INTEGER NOT NULL,
    "valuePerHour" INTEGER NOT NULL,
    "totalValue" INTEGER NOT NULL,
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
