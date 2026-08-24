-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_VirtualAssetEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "activityId" TEXT,
    "taskId" TEXT,
    "categoryId" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "valuePerHour" INTEGER NOT NULL,
    "totalValue" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VirtualAssetEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VirtualAssetEntry_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VirtualAssetEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VirtualAssetEntry" ("activityId", "categoryId", "createdAt", "date", "durationMin", "id", "totalValue", "userId", "valuePerHour") SELECT "activityId", "categoryId", "createdAt", "date", "durationMin", "id", "totalValue", "userId", "valuePerHour" FROM "VirtualAssetEntry";
DROP TABLE "VirtualAssetEntry";
ALTER TABLE "new_VirtualAssetEntry" RENAME TO "VirtualAssetEntry";
CREATE UNIQUE INDEX "VirtualAssetEntry_activityId_key" ON "VirtualAssetEntry"("activityId");
CREATE UNIQUE INDEX "VirtualAssetEntry_taskId_key" ON "VirtualAssetEntry"("taskId");
CREATE INDEX "VirtualAssetEntry_userId_idx" ON "VirtualAssetEntry"("userId");
CREATE INDEX "VirtualAssetEntry_date_idx" ON "VirtualAssetEntry"("date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
