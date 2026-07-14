import { PrismaClient } from '@prisma/client';
import { auth } from '../src/modules/identity/auth.config';
import { ROLES, type Role } from '../src/modules/identity/constants/roles.constants';
import { logger } from '../src/shared/utils/logger/logger';
import { DEFAULT_GS1_COMPANY_PREFIX, gs1Utils } from '../src/shared/utils/gs1/gs1.utils';

const prisma = new PrismaClient();

/**
 * Identifiants FIXES : c'est ce qui rend le seed rejouable. Avec des identifiants générés, chaque
 * relance recréait le catalogue et les lots en double — visibles dans le sélecteur du mobile, où
 * l'opérateur avait une chance sur deux de choisir le doublon.
 */
const IDS = {
  supplier: '11111111-1111-4111-8111-111111111111',
  customer: '22222222-2222-4222-8222-222222222222',
  invitation: '33333333-3333-4333-8333-333333333333',
  milk: '44444444-4444-4444-8444-444444444444',
  butter: '55555555-5555-4555-8555-555555555555',
  milkBatch: '66666666-6666-4666-8666-666666666666',
  butterBatch: '77777777-7777-4777-8777-777777777777',
} as const;

/** Commun à tous les comptes de démonstration : ce seed ne tourne qu'en développement. */
const DEMO_PASSWORD = 'NutriChain!2026';

/**
 * Un compte par rôle. Sans eux, le seul utilisateur du seed est un `owner`, qui a TOUS les droits :
 * il masque chaque 403. On croyait le cloisonnement des rôles solide — on ne l'avait jamais
 * exercé. Et « connectez-vous en opérateur » était matériellement impossible.
 */
const DEMO_MEMBERS: { email: string; name: string; role: Role }[] = [
  { email: 'admin@nutrichain.local', name: 'Admin Traceability', role: ROLES.OWNER },
  { email: 'admin.demo@nutrichain.local', name: 'Amélie Admin', role: ROLES.ADMIN },
  { email: 'quality@nutrichain.local', name: 'Quentin Qualité', role: ROLES.QUALITY },
  { email: 'operator@nutrichain.local', name: 'Olivia Opératrice', role: ROLES.OPERATOR },
  { email: 'viewer@nutrichain.local', name: 'Victor Visiteur', role: ROLES.VIEWER },
];

/**
 * Crée un membre CONNECTABLE : un `User` sans ligne `Account` n'a pas de mot de passe et ne peut
 * pas se connecter — c'était le cas de l'unique utilisateur du seed, et personne ne s'en était
 * aperçu parce qu'on entrait toujours par l'invitation.
 *
 * Le mot de passe est haché par Better-Auth lui-même : le hacher à la main produirait des comptes
 * que sa propre vérification rejetterait.
 */
async function upsertMember(
  organizationId: string,
  passwordHash: string,
  { email, name, role }: { email: string; name: string; role: Role }
): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email },
    update: { name },
    create: { email, name, emailVerified: true },
  });

  await prisma.account.upsert({
    where: { id: `account-${user.id}` },
    update: { password: passwordHash },
    create: {
      id: `account-${user.id}`,
      accountId: user.id,
      providerId: 'credential',
      userId: user.id,
      password: passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  await prisma.member.upsert({
    where: { id: `member-${user.id}-${organizationId}` },
    // Le rôle est REMIS à sa valeur attendue : un seed qu'on relance doit rétablir l'état de
    // démonstration, pas entériner ce qu'une manipulation a laissé derrière elle.
    update: { role },
    create: {
      id: `member-${user.id}-${organizationId}`,
      organizationId,
      userId: user.id,
      role,
      createdAt: new Date(),
    },
  });

  return user.id;
}

/**
 * Administrateur de PLATEFORME (personnel NutriChain). Connectable (compte credential), mais
 * VOLONTAIREMENT sans aucun `Member` : c'est l'absence d'organisation active qui lui interdit
 * d'atteindre les données métier d'un client. Lui donner un Member ouvrirait cette porte.
 */
async function upsertPlatformAdmin(
  passwordHash: string,
  { email, name }: { email: string; name: string }
): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email },
    update: { name },
    create: { email, name, emailVerified: true },
  });

  await prisma.account.upsert({
    where: { id: `account-${user.id}` },
    update: { password: passwordHash },
    create: {
      id: `account-${user.id}`,
      accountId: user.id,
      providerId: 'credential',
      userId: user.id,
      password: passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  await prisma.platformAdmin.upsert({
    where: { userId: user.id },
    update: {},
    create: { id: `platform-${user.id}`, userId: user.id },
  });

  return user.id;
}

async function main() {
  logger.info('🌱 Start seeding Traceability...');

  const usine = await prisma.organization.upsert({
    where: { slug: 'usine-laitiere-paris' },
    // update aussi : les bases déjà seedées récupèrent le préfixe GS1 au re-seed.
    update: { gs1_company_prefix: DEFAULT_GS1_COMPANY_PREFIX },
    create: {
      id: 'usine-laitiere-paris',
      name: 'Usine Laitière de Paris',
      slug: 'usine-laitiere-paris',
      createdAt: new Date(),
      gs1_company_prefix: DEFAULT_GS1_COMPANY_PREFIX,
    },
  });

  // 1. Les comptes, un par rôle. Le hachage est calculé UNE fois : scrypt est volontairement lent.
  const ctx = await auth.$context;
  const passwordHash = await ctx.password.hash(DEMO_PASSWORD);

  const userIdsByRole = new Map<Role, string>();

  for (const member of DEMO_MEMBERS) {
    userIdsByRole.set(member.role, await upsertMember(usine.id, passwordHash, member));
  }

  // Admin de plateforme (personnel NutriChain) — hors de toute organisation.
  await upsertPlatformAdmin(passwordHash, {
    email: 'platform@nutrichain.local',
    name: 'Admin Plateforme',
  });

  const ownerId = userIdsByRole.get(ROLES.OWNER)!;

  // 2. Fournisseur et client par défaut (flux Réception / Expédition).
  const supplier = await prisma.supplier.upsert({
    where: { id: IDS.supplier },
    update: {},
    create: {
      id: IDS.supplier,
      organization_id: usine.id,
      nom_ferme: 'Ferme Bio de Paris',
      type_produit: 'Lait cru',
      adresse_siege: '1 rue des Champs, 75001 Paris',
    },
  });

  const customer = await prisma.customer.upsert({
    where: { id: IDS.customer },
    update: {},
    create: {
      id: IDS.customer,
      organization_id: usine.id,
      nom_enseigne: 'Supermarché Central',
      email: 'contact@supermarche-central.example',
      adresse_livraison: '50 avenue de la Distribution, 75010 Paris',
    },
  });

  // 3. Les unités AVANT les produits et les lots, qui s'y réfèrent.
  await prisma.unit.createMany({
    data: [
      { code: 'L', nom: 'Litres', factor_to_base: 1 },
      { code: 'kg', nom: 'Kilogrammes', factor_to_base: 1 },
      { code: 'U', nom: 'Unités', factor_to_base: 1 },
    ],
    skipDuplicates: true,
  });

  // 4. Catalogue.
  const milk = await prisma.product.upsert({
    where: { id: IDS.milk },
    update: {},
    create: {
      id: IDS.milk,
      organization_id: usine.id,
      nom: 'Bouteille de Lait 1L (Entier)',
      code_gtin: '3042040209123',
      categorie: 'Produit Laitier',
      duree_conservation_defaut: 30, // en jours
      seuil_alerte_stock: 500,
      unite_reference: 'L',
    },
  });

  const butter = await prisma.product.upsert({
    where: { id: IDS.butter },
    update: {},
    create: {
      id: IDS.butter,
      organization_id: usine.id,
      nom: 'Plaquette de Beurre Doux 250g',
      code_gtin: '3042040209456',
      categorie: 'Produit Laitier',
      duree_conservation_defaut: 90,
      seuil_alerte_stock: 200,
      unite_reference: 'kg',
    },
  });

  // 5. Lots. Le numéro de lot GS1 n'est tiré qu'à la création : le régénérer à chaque relance ferait
  // « bouger » sous les yeux le lot que l'on est justement en train de scanner.
  await prisma.batch.upsert({
    where: { id: IDS.milkBatch },
    update: {},
    create: {
      id: IDS.milkBatch,
      organization_id: usine.id,
      lot_number: gs1Utils.generateLotNumber(),
      id_produit: milk.id,
      quantite_actuelle: 1000,
      unite_code: 'L',
      quantite_base: 1000,
      date_peremption: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // +30 jours
      statut: 'EN_STOCK',
      created_by: ownerId,
    },
  });

  await prisma.batch.upsert({
    where: { id: IDS.butterBatch },
    update: {},
    create: {
      id: IDS.butterBatch,
      organization_id: usine.id,
      lot_number: gs1Utils.generateLotNumber(),
      id_produit: butter.id,
      quantite_actuelle: 400, // represente 100kg (400*250g)
      unite_code: 'kg',
      quantite_base: 100,
      date_peremption: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // +90 jours
      statut: 'EN_STOCK',
      created_by: ownerId,
    },
  });

  // 6. Invitation pré-pending : conservée pour le parcours « inscription sur invitation », seul
  // chemin d'entrée d'un utilisateur absent de ce seed.
  const DEV_INVITATION_EMAIL = 'first.admin@nutrichain.local';
  await prisma.invitation.upsert({
    where: { id: IDS.invitation },
    update: {
      status: 'pending',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    create: {
      id: IDS.invitation,
      organizationId: usine.id,
      email: DEV_INVITATION_EMAIL,
      role: ROLES.OWNER,
      status: 'pending',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      inviterId: ownerId,
    },
  });

  logger.info('✅ Seeding finished.');
  logger.info(`   org_id=${usine.id}`);
  logger.info(`   supplier_id=${supplier.id}`);
  logger.info(`   customer_id=${customer.id}`);
  logger.info(`   product_id (milk)=${milk.id}`);
  logger.info(`   product_id (butter)=${butter.id}`);
  logger.info(`   invitation pending pour: ${DEV_INVITATION_EMAIL} (role owner)`);
  logger.info(`   comptes — mot de passe commun « ${DEMO_PASSWORD} » :`);

  for (const { email, role } of DEMO_MEMBERS) {
    logger.info(`     - ${email} → ${role}`);
  }
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
