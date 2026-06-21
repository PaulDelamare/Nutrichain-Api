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

  // 2.a Fournisseur et client par défaut (utiles pour les flows Receipts/Shipments)
  // UUIDs stables hard-codés pour permettre l'upsert idempotent ET satisfaire la validation UUID côté API.
  const SUPPLIER_ID = '11111111-1111-4111-8111-111111111111';
  const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';

  const supplier = await prisma.supplier.upsert({
    where: { id: SUPPLIER_ID },
    update: {},
    create: {
      id: SUPPLIER_ID,
      organization_id: usine.id,
      nom_ferme: 'Ferme Bio de Paris',
      type_produit: 'Lait cru',
      adresse_siege: '1 rue des Champs, 75001 Paris',
    },
  });

  const customer = await prisma.customer.upsert({
    where: { id: CUSTOMER_ID },
    update: {},
    create: {
      id: CUSTOMER_ID,
      organization_id: usine.id,
      nom_enseigne: 'Supermarché Central',
      email: 'contact@supermarche-central.example',
      adresse_livraison: '50 avenue de la Distribution, 75010 Paris',
    },
  });

  // 2.b Création de produits (Catalogue)
  const milk = await prisma.product.create({
    data: {
      organization_id: usine.id,
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
      organization_id: usine.id,
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
      organization_id: usine.id,
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
      organization_id: usine.id,
      id_produit: butter.id,
      quantite_actuelle: 400, // represente 100kg (400*250g)
      unite_code: 'kg',
      quantite_base: 100,
      date_peremption: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // +90 jours
      statut: 'EN_STOCK',
      created_by: adminUser.id,
    },
  });

  // 5. Invitation pré-pending pour permettre un sign-up de dev sans gymnastique
  // (sans cette invitation, le guardSignUp refuse l'inscription puisque l'admin du seed
  // existe déjà → on n'est plus "premier user"). L'email cible accepte une connexion
  // immédiate via Better-Auth Sign Up, et le hook auth.config rattache automatiquement
  // le nouveau user à l'organisation usine-laitiere-paris comme owner.
  const DEV_INVITATION_ID = '33333333-3333-4333-8333-333333333333';
  const DEV_INVITATION_EMAIL = 'first.admin@nutrichain.local';
  await prisma.invitation.upsert({
    where: { id: DEV_INVITATION_ID },
    update: {
      status: 'pending',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    create: {
      id: DEV_INVITATION_ID,
      organizationId: usine.id,
      email: DEV_INVITATION_EMAIL,
      role: 'owner',
      status: 'pending',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      inviterId: adminUser.id,
    },
  });

  logger.info('✅ Seeding finished.');
  logger.info(`   org_id=${usine.id}`);
  logger.info(`   admin_user_id=${adminUser.id}`);
  logger.info(`   supplier_id=${supplier.id}`);
  logger.info(`   customer_id=${customer.id}`);
  logger.info(`   product_id (milk)=${milk.id}`);
  logger.info(`   product_id (butter)=${butter.id}`);
  logger.info(`   dev invitation pending pour: ${DEV_INVITATION_EMAIL} (role owner)`);
}

main()
  .catch((e) => {
    console.error(e);
    logger.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });