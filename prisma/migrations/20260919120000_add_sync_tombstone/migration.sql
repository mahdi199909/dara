-- CreateTable
CREATE TABLE "SyncTombstone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "table" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "deletedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SyncTombstone_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SyncTombstone_userId_deletedAt_idx" ON "SyncTombstone"("userId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncTombstone_userId_table_rowId_key" ON "SyncTombstone"("userId", "table", "rowId");

