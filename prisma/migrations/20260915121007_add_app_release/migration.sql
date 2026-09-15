-- CreateTable
CREATE TABLE "AppRelease" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "latestVersionCode" INTEGER NOT NULL,
    "minSupportedVersionCode" INTEGER NOT NULL,
    "downloadUrl" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
