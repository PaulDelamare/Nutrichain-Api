-- AlterTable
ALTER TABLE "Batch" ADD COLUMN     "id_receipt" TEXT;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_id_receipt_fkey" FOREIGN KEY ("id_receipt") REFERENCES "Receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
