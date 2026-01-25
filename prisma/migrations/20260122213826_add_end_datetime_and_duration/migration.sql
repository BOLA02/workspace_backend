/*
  Warnings:

  - Added the required column `endDateTime` to the `usage_records` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "usage_records" ADD COLUMN     "duration" TEXT,
ADD COLUMN     "endDateTime" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "usage_records_endDateTime_idx" ON "usage_records"("endDateTime");
