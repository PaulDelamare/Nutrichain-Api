-- CreateIndex
-- Le rappel produit lit Liaison_Shipment par `id_lot IN (...)` (recall.service.ts), sans index
-- jusqu'ici : seq scan a chaque rappel. `id_expedition` couvre la jointure vers Shipment.
CREATE INDEX "Liaison_Shipment_id_lot_idx" ON "Liaison_Shipment"("id_lot");

-- CreateIndex
CREATE INDEX "Liaison_Shipment_id_expedition_idx" ON "Liaison_Shipment"("id_expedition");
