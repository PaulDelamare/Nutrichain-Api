-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "external_ref" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Customer_organization_id_external_ref_key" ON "Customer"("organization_id", "external_ref");

