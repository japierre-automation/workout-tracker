-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "LogStatus" AS ENUM ('DONE', 'FAILED');

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "startDate" DATE NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Day" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "label" TEXT,
    "order" INTEGER NOT NULL,

    CONSTRAINT "Day_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseRevision" (
    "id" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "effectiveFromIndex" INTEGER NOT NULL,
    "startWeightLb" DECIMAL(7,3) NOT NULL,
    "sets" INTEGER NOT NULL,
    "reps" INTEGER NOT NULL,
    "incrementLb" DECIMAL(6,3) NOT NULL,
    "failureMultiplier" DECIMAL(4,3) NOT NULL DEFAULT 0.900,
    "roundingStepLb" DECIMAL(6,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExerciseRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionLog" (
    "id" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "occurrenceIndex" INTEGER NOT NULL,
    "prescribedWeightLb" DECIMAL(7,3) NOT NULL,
    "status" "LogStatus" NOT NULL,
    "manualNextWeightLb" DECIMAL(7,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Day_programId_order_idx" ON "Day"("programId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Day_programId_weekday_key" ON "Day"("programId", "weekday");

-- CreateIndex
CREATE INDEX "Exercise_dayId_order_idx" ON "Exercise"("dayId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseRevision_exerciseId_effectiveFromIndex_key" ON "ExerciseRevision"("exerciseId", "effectiveFromIndex");

-- CreateIndex
CREATE INDEX "SessionLog_date_idx" ON "SessionLog"("date");

-- CreateIndex
CREATE UNIQUE INDEX "SessionLog_exerciseId_occurrenceIndex_key" ON "SessionLog"("exerciseId", "occurrenceIndex");

-- AddForeignKey
ALTER TABLE "Day" ADD CONSTRAINT "Day_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "Day"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseRevision" ADD CONSTRAINT "ExerciseRevision_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionLog" ADD CONSTRAINT "SessionLog_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

