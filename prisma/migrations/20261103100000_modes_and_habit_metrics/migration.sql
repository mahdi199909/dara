-- AlterTable
ALTER TABLE "Habit" ADD COLUMN "metricKind" TEXT;

-- AlterTable
ALTER TABLE "HabitCheckIn" ADD COLUMN "amount" REAL;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "gender" TEXT;
ALTER TABLE "Settings" ADD COLUMN "modes" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "boxMinutes" INTEGER;

