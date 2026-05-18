import { prisma } from '../src/shared/configs/prismaClient.config';

async function main() {
  try {
    console.log('Seed: upsert Supplier...');
    await prisma.supplier.upsert({
      where: { id: '123e4567-e89b-12d3-a456-426614174000' },
      update: {},
      create: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        nom_ferme: 'Ferme Test',
        adresse_siege: 'Adresse Test',
      },
    });

    console.log('Seed: upsert Product...');
    await prisma.product.upsert({
      where: { id: '123e4567-e89b-12d3-a456-426614174001' },
      update: {},
      create: {
        id: '123e4567-e89b-12d3-a456-426614174001',
        nom: 'Produit Test',
        categorie: 'Test',
        duree_conservation_defaut: 365,
        seuil_alerte_stock: 0,
        unite_reference: 'KG',
      },
    });

    console.log('Seed: upsert User...');
    await prisma.user.upsert({
      where: { id: '123e4567-e89b-12d3-a456-426614174099' },
      update: {},
      create: {
        id: '123e4567-e89b-12d3-a456-426614174099',
        email: 'test.user@example.com',
        name: 'Test User',
      },
    });

    console.log('Seed: upsert Unit...');
    await prisma.unit.upsert({
      where: { code: 'KG' },
      update: {},
      create: {
        code: 'KG',
        nom: 'Kilogramme',
        factor_to_base: 1,
      },
    });

    console.log('Seed completed.');
  } catch (e) {
    console.error('Seed error:', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
