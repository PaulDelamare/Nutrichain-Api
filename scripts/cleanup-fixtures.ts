import { prisma } from '../src/shared/configs/prismaClient.config';

async function main() {
  const supplierId = '123e4567-e89b-12d3-a456-426614174000';
  const productId = '123e4567-e89b-12d3-a456-426614174001';
  const userId = '123e4567-e89b-12d3-a456-426614174099';
  const receiptId = '153c0ca6-6711-4dfb-9a84-97b8d484554b';
  const batchId = 'b38b70a7-ed6e-4033-98b4-7d9e49fc9725';

  try {
    console.log('Deleting Receipt...');
    await prisma.receipt.deleteMany({ where: { id: receiptId } });

    console.log('Deleting Batch...');
    await prisma.batch.deleteMany({ where: { id: batchId } });

    console.log('Deleting Supplier...');
    await prisma.supplier.deleteMany({ where: { id: supplierId } });

    console.log('Deleting Product...');
    await prisma.product.deleteMany({ where: { id: productId } });

    console.log('Deleting User...');
    await prisma.user.deleteMany({ where: { id: userId } });

    console.log('Cleanup completed.');
  } catch (e) {
    console.error('Cleanup error:', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
