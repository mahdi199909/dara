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
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "generatesVirtualAsset" BOOLEAN NOT NULL DEFAULT false,
    "virtualAssetValuePerHour" INTEGER,
    "projectId" TEXT,
    "parentCategoryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Category_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Category_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Category_parentCategoryId_fkey" FOREIGN KEY ("parentCategoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Category" ("color", "createdAt", "deletedAt", "generatesVirtualAsset", "icon", "id", "isActive", "kind", "name", "projectId", "updatedAt", "userId", "valueType", "virtualAssetValuePerHour") SELECT "color", "createdAt", "deletedAt", "generatesVirtualAsset", "icon", "id", "isActive", "kind", "name", "projectId", "updatedAt", "userId", "valueType", "virtualAssetValuePerHour" FROM "Category";
DROP TABLE "Category";
ALTER TABLE "new_Category" RENAME TO "Category";
CREATE UNIQUE INDEX "Category_projectId_key" ON "Category"("projectId");
CREATE INDEX "Category_userId_idx" ON "Category"("userId");
CREATE INDEX "Category_parentCategoryId_idx" ON "Category"("parentCategoryId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
