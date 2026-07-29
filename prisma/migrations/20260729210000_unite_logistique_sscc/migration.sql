-- Unite logistique (palette) identifiee par son SSCC.
--
-- Liaison_Shipment.pallet_id est supprimee au profit de id_unite_logistique, qui porte une vraie
-- cle etrangere. La suppression est sans perte : la colonne etait declaree depuis la migration
-- initiale et n'etait ecrite par AUCUN chemin de production. Verifie avant d'ecrire cette
-- migration par SELECT count(pallet_id) FROM "Liaison_Shipment", qui rendait 0 sur 5 lignes.
-- Une valeur qui s'y trouverait malgre tout ne serait de toute facon pas l'identifiant d'une
-- table qui n'existait pas encore.

-- AlterTable
ALTER TABLE "Liaison_Shipment" DROP COLUMN "pallet_id",
ADD COLUMN     "id_unite_logistique" TEXT;

-- CreateTable
CREATE TABLE "Logistic_Unit" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "sscc" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'INTERNE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "Logistic_Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Logistic_Unit_Content" (
    "id_unite_logistique" TEXT NOT NULL,
    "id_lot" TEXT NOT NULL,
    "quantite" DECIMAL(65,30) NOT NULL,
    "unite" TEXT NOT NULL,

    CONSTRAINT "Logistic_Unit_Content_pkey" PRIMARY KEY ("id_unite_logistique","id_lot")
);

-- CreateIndex
CREATE INDEX "Logistic_Unit_organization_id_idx" ON "Logistic_Unit"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "Logistic_Unit_organization_id_sscc_key" ON "Logistic_Unit"("organization_id", "sscc");

-- CreateIndex
CREATE INDEX "Logistic_Unit_Content_id_lot_idx" ON "Logistic_Unit_Content"("id_lot");

-- CreateIndex
CREATE INDEX "Liaison_Shipment_id_unite_logistique_idx" ON "Liaison_Shipment"("id_unite_logistique");

-- AddForeignKey
ALTER TABLE "Liaison_Shipment" ADD CONSTRAINT "Liaison_Shipment_id_unite_logistique_fkey" FOREIGN KEY ("id_unite_logistique") REFERENCES "Logistic_Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Logistic_Unit" ADD CONSTRAINT "Logistic_Unit_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Logistic_Unit" ADD CONSTRAINT "Logistic_Unit_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Logistic_Unit_Content" ADD CONSTRAINT "Logistic_Unit_Content_id_unite_logistique_fkey" FOREIGN KEY ("id_unite_logistique") REFERENCES "Logistic_Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Logistic_Unit_Content" ADD CONSTRAINT "Logistic_Unit_Content_id_lot_fkey" FOREIGN KEY ("id_lot") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

