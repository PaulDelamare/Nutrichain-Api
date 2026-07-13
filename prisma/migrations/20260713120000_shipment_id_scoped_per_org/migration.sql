-- DropIndex
DROP INDEX "Receipt_shipment_id_key";

-- DropIndex
DROP INDEX "Shipment_shipment_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_organization_id_shipment_id_key" ON "Receipt"("organization_id", "shipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_organization_id_shipment_id_key" ON "Shipment"("organization_id", "shipment_id");

