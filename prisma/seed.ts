import { PrismaClient } from '@prisma/client';
import { logger } from '../src/shared/utils/logger/logger';

const prisma = new PrismaClient();

async function main() {
  logger.info('🌱 Start seeding Traceability...');

  // 1. Création d'organisations fictives (Si Better-Auth ou les données l'exigent plus tard)
  const usine = await prisma.organization.upsert({
    where: { slug: 'usine-laitiere-paris' },
    update: {},
    create: {
      id: 'usine-laitiere-paris',
      name: 'Usine Laitière de Paris',
      slug: 'usine-laitiere-paris',
      createdAt: new Date(),
    },
  });

  // Création du super admin par défaut
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@nutrichain.local' },
    update: {},
    create: {
      email: 'admin@nutrichain.local',
      name: 'Admin Traceability',
      emailVerified: true,
    },
  });

  // Associer cet Admin au lieu/organisation avec le rôle d'owner
  await prisma.member.upsert({
    where: { id: `member-${adminUser.id}-${usine.id}` },
    update: {},
    create: {
      id: `member-${adminUser.id}-${usine.id}`,
      organizationId: usine.id,
      userId: adminUser.id,
      role: 'owner',
      createdAt: new Date(),
    }
  });

  // 2. Création de produits (Catalogue)
  const milk = await prisma.product.create({
    data: {
      nom: 'Bouteille de Lait 1L (Entier)',
      code_gtin: '3042040209123',
      categorie: 'Produit Laitier',
      duree_conservation_defaut: 30, // en jours
      seuil_alerte_stock: 500,
      unite_reference: 'L',
    },
  });

  const butter = await prisma.product.create({
    data: {
      nom: 'Plaquette de Beurre Doux 250g',
      code_gtin: '3042040209456',
      categorie: 'Produit Laitier',
      duree_conservation_defaut: 90,
      seuil_alerte_stock: 200,
      unite_reference: 'kg',
    },
  });

  // 3. Création des Unités (nécessaire pour les Lots)
  await prisma.unit.createMany({
    data: [
      { code: 'L', nom: 'Litres', factor_to_base: 1 },
      { code: 'kg', nom: 'Kilogrammes', factor_to_base: 1 },
      { code: 'U', nom: 'Unités', factor_to_base: 1 },
    ],
    skipDuplicates: true,
  });

  // 4. Création de lots (Batches) rattachés aux produits
  await prisma.batch.create({
    data: {
      id_produit: milk.id,
      quantite_actuelle: 1000,
      unite_code: 'L',
      quantite_base: 1000,
      date_peremption: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // +30 jours
      statut: 'EN_STOCK',
      created_by: adminUser.id,
    },
  });

  await prisma.batch.create({
    data: {
      id_produit: butter.id,
      quantite_actuelle: 400, // represente 100kg (400*250g)
      unite_code: 'kg',
      quantite_base: 100,
      date_peremption: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // +90 jours
      statut: 'EN_STOCK',
      created_by: adminUser.id,
    },
  });

  logger.info('✅ Seeding finished.');
}

main()
  .catch((e) => {
    logger.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });