-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "id_client" TEXT NOT NULL,
    "id_lot" TEXT NOT NULL,
    "quantite" DECIMAL(65,30) NOT NULL,
    "unite" TEXT NOT NULL,
    "motif" TEXT NOT NULL,
    "retire_par" TEXT NOT NULL,
    "constate_aupres_de" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Withdrawal_organization_id_idx" ON "Withdrawal"("organization_id");

-- CreateIndex
CREATE INDEX "Withdrawal_id_lot_id_client_idx" ON "Withdrawal"("id_lot", "id_client");

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_id_client_fkey" FOREIGN KEY ("id_client") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_id_lot_fkey" FOREIGN KEY ("id_lot") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_retire_par_fkey" FOREIGN KEY ("retire_par") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

