-- CreateIndex
CREATE UNIQUE INDEX "Product_organization_id_code_gtin_key" ON "Product"("organization_id", "code_gtin");
