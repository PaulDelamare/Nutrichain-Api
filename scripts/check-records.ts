import { prisma } from '../src/shared/configs/prismaClient.config';

async function main() {
  try {
    const supplierId = '123e4567-e89b-12d3-a456-426614174000';
    const productId = '123e4567-e89b-12d3-a456-426614174001';
    const userId = '123e4567-e89b-12d3-a456-426614174099';
    const receiptId = '153c0ca6-6711-4dfb-9a84-97b8d484554b';
    const batchId = 'b38b70a7-ed6e-4033-98b4-7d9e49fc9725';

    console.log('Checking Supplier...');
    const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
    console.log('supplier:', JSON.stringify(supplier, null, 2));

    console.log('\nChecking Product...');
    const product = await prisma.product.findUnique({ where: { id: productId } });
    console.log('product:', JSON.stringify(product, null, 2));

    console.log('\nChecking User...');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    console.log('user:', JSON.stringify(user, null, 2));

    console.log('\nChecking Receipt...');
    const receipt = await prisma.receipt.findUnique({ where: { id: receiptId } });
    console.log('receipt:', JSON.stringify(receipt, null, 2));

    console.log('\nChecking Batch...');
    const batch = await prisma.batch.findUnique({ where: { id: batchId } });
    console.log('batch:', JSON.stringify(batch, null, 2));

  } catch (e) {
    console.error('Error querying DB:', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
