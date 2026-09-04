-- CreateTable
CREATE TABLE "ShownInsight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "insightId" TEXT NOT NULL,
    "shownAt" DATETIME NOT NULL,
    CONSTRAINT "ShownInsight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ShownInsight_userId_shownAt_idx" ON "ShownInsight"("userId", "shownAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShownInsight_userId_insightId_key" ON "ShownInsight"("userId", "insightId");
