-- CreateTable
CREATE TABLE "ScrapRecord" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "id_lot" TEXT NOT NULL,
    "quantite" DECIMAL(65,30) NOT NULL,
    "unite" TEXT NOT NULL,
    "motif" TEXT NOT NULL,
    "id_user" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScrapRecord_id_lot_key" ON "ScrapRecord"("id_lot");

-- CreateIndex
CREATE INDEX "ScrapRecord_organization_id_idx" ON "ScrapRecord"("organization_id");

-- AddForeignKey
ALTER TABLE "ScrapRecord" ADD CONSTRAINT "ScrapRecord_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapRecord" ADD CONSTRAINT "ScrapRecord_id_lot_fkey" FOREIGN KEY ("id_lot") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapRecord" ADD CONSTRAINT "ScrapRecord_id_user_fkey" FOREIGN KEY ("id_user") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
