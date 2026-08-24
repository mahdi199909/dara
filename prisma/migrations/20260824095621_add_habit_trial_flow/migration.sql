-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Habit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT NOT NULL DEFAULT '#3a8d80',
    "categoryId" TEXT,
    "virtualAssetValuePerCheckIn" INTEGER NOT NULL DEFAULT 0,
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
INSERT INTO "new_Habit" ("categoryId", "color", "createdAt", "deletedAt", "description", "icon", "id", "isActive", "lastNudgeSentAt", "title", "updatedAt", "userId", "virtualAssetValuePerCheckIn") SELECT "categoryId", "color", "createdAt", "deletedAt", "description", "icon", "id", "isActive", "lastNudgeSentAt", "title", "updatedAt", "userId", "virtualAssetValuePerCheckIn" FROM "Habit";
DROP TABLE "Habit";
ALTER TABLE "new_Habit" RENAME TO "Habit";
CREATE INDEX "Habit_userId_idx" ON "Habit"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
