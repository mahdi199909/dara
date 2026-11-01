-- AlterTable
ALTER TABLE "Project" ADD COLUMN "visionItemId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "visionItemId" TEXT;
ALTER TABLE "Task" ADD COLUMN "visionValue" REAL;

-- CreateTable
CREATE TABLE "VisionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT NOT NULL DEFAULT '#3a8d80',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT,
    "startValue" REAL NOT NULL DEFAULT 0,
    "targetValue" REAL,
    "mode" TEXT NOT NULL DEFAULT 'ADD',
    "targetDate" DATETIME,
    "achievedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "VisionItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VisionEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "date" DATETIME NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "VisionEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VisionEntry_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "VisionItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "VisionItem_userId_idx" ON "VisionItem"("userId");

-- CreateIndex
CREATE INDEX "VisionEntry_userId_idx" ON "VisionEntry"("userId");

-- CreateIndex
CREATE INDEX "VisionEntry_itemId_idx" ON "VisionEntry"("itemId");

