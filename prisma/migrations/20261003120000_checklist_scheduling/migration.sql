-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ChecklistItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" DATETIME,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "durationMin" INTEGER,
    "depType" TEXT,
    "depItemId" TEXT,
    "lagMin" INTEGER NOT NULL DEFAULT 0,
    "linkedType" TEXT,
    "linkedId" TEXT,
    "linkedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "ChecklistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ChecklistItem" ("checked", "checkedAt", "createdAt", "deletedAt", "id", "note", "parentId", "sortOrder", "title", "updatedAt", "userId") SELECT "checked", "checkedAt", "createdAt", "deletedAt", "id", "note", "parentId", "sortOrder", "title", "updatedAt", "userId" FROM "ChecklistItem";
DROP TABLE "ChecklistItem";
ALTER TABLE "new_ChecklistItem" RENAME TO "ChecklistItem";
CREATE INDEX "ChecklistItem_userId_idx" ON "ChecklistItem"("userId");
CREATE INDEX "ChecklistItem_parentId_idx" ON "ChecklistItem"("parentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

