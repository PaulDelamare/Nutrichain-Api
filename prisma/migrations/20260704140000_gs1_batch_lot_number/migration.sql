-- GS1 strict (#17) : numéro de lot court AI (10) porté par les URN LGTIN et le Digital Link.
-- Backfill des lots existants : dérivé déterministe de l'UUID (13 caractères hex, unique en pratique),
-- la contrainte d'unicité (organization_id, lot_number) sert de garde-fou.
ALTER TABLE "Batch" ADD COLUMN "lot_number" TEXT;
UPDATE "Batch" SET "lot_number" = UPPER(LEFT(REPLACE("id", '-', ''), 13));
ALTER TABLE "Batch" ALTER COLUMN "lot_number" SET NOT NULL;
CREATE UNIQUE INDEX "Batch_organization_id_lot_number_key" ON "Batch"("organization_id", "lot_number");

-- Table orpheline (jamais alimentée par aucun service) : les AggregationEvents
-- sont désormais émis comme lignes EPCIS_Event (parentID = URN SSCC).
DROP TABLE "EPCIS_Aggregation_Event";
