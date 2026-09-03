-- CreateTable
CREATE TABLE "CapitalSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "investedMinutes" INTEGER NOT NULL,
    "virtualAssetValue" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CapitalSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CapitalSnapshot_userId_idx" ON "CapitalSnapshot"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CapitalSnapshot_userId_date_key" ON "CapitalSnapshot"("userId", "date");
