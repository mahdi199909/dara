-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Settings" ("calendarType", "createdAt", "currency", "currencyDisplayUnit", "dashboardCardPrefs", "hourlyValueOverride", "id", "monthlyIncome", "timezone", "updatedAt", "userId", "workingHoursMonth") SELECT "calendarType", "createdAt", "currency", "currencyDisplayUnit", "dashboardCardPrefs", "hourlyValueOverride", "id", "monthlyIncome", "timezone", "updatedAt", "userId", "workingHoursMonth" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
CREATE UNIQUE INDEX "Settings_userId_key" ON "Settings"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
