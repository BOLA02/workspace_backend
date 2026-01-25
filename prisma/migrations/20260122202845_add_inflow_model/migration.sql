/*
  Warnings:

  - The `category` column on the `expenses` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "expenses" DROP COLUMN "category",
ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'GENERAL';

-- DropEnum
DROP TYPE "ExpenseCategory";

-- CreateTable
CREATE TABLE "inflows" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "duration" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inflows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inflows_createdById_idx" ON "inflows"("createdById");

-- CreateIndex
CREATE INDEX "inflows_startDate_idx" ON "inflows"("startDate");

-- CreateIndex
CREATE INDEX "inflows_category_idx" ON "inflows"("category");

-- CreateIndex
CREATE INDEX "expenses_category_idx" ON "expenses"("category");

-- AddForeignKey
ALTER TABLE "inflows" ADD CONSTRAINT "inflows_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
