/*
  Warnings:

  - Made the column `failedVerificationCount` on table `twoFactor` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "twoFactor" ALTER COLUMN "failedVerificationCount" SET NOT NULL;
