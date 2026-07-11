/**
 * Seed de DÉMONSTRATION — jeu de données riche et cohérent pour la soutenance.
 *
 * S'ajoute par-dessus le seed de base (`prisma/seed.ts`) : réutilise l'organisation,
 * l'admin, le fournisseur et le client seedés, et construit une chaîne complète
 * matière → transformation → produit fini → expédition, plus des sites réels, du
 * matériel avec capteurs, une alerte froid, des contrôles qualité et un lot en
 * quarantaine. Objectif : que Traçabilité, Rappels, Chaîne du froid, etc. ne soient
 * plus vides en démo.
 *
 * Idempotent : IDs fixes, purge des données de démo précédentes avant recréation,
 * + nettoyage des résidus de tests e2e (`E2E-*`).
 *
 * Lancement : npm run seed:demo   (après npm run db:seed)
 */
import 'dotenv/config';
import { prisma } from '../src/shared/configs/prismaClient.config';
import { logger } from '../src/shared/utils/logger/logger';

// UUID déterministes (satisfont la validation vine.uuid() des routes métier).
const ID = {
  locReception: 'd0000000-0000-4000-8000-000000000001',
  locFroid: 'd0000000-0000-4000-8000-000000000002',
  locProduction: 'd0000000-0000-4000-8000-000000000003',
  eqFrigo: 'd0000000-0000-4000-8000-000000000011',
  eqCuve: 'd0000000-0000-4000-8000-000000000012',
  prodLaitCru: 'd0000000-0000-4000-8000-000000000021',
  lotCruA: 'd0000000-0000-4000-8000-000000000031',
  lotCruB: 'd0000000-0000-4000-8000-000000000032',
  lotLait: 'd0000000-0000-4000-8000-000000000033',
  lotBeurre: 'd0000000-0000-4000-8000-000000000034',
  lotQuarantaine: 'd0000000-0000-4000-8000-000000000035',
  transfoLait: 'd0000000-0000-4000-8000-000000000041',
  transfoBeurre: 'd0000000-0000-4000-8000-000000000042',
  shipLait: 'd0000000-0000-4000-8000-000000000051',
  shipBeurre: 'd0000000-0000-4000-8000-000000000052',
  customer2: 'd0000000-0000-4000-8000-000000000061',
  alertFroid: 'd0000000-0000-4000-8000-000000000071',
};

const ALL_LOTS = [ID.lotCruA, ID.lotCruB, ID.lotLait, ID.lotBeurre, ID.lotQuarantaine];
const ALL_TRANSFOS = [ID.transfoLait, ID.transfoBeurre];
const ALL_SHIPMENTS = [ID.shipLait, ID.shipBeurre];
const ALL_EQUIP = [ID.eqFrigo, ID.eqCuve];
const ALL_LOCS = [ID.locReception, ID.locFroid, ID.locProduction];

const day = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

async function purgePreviousDemo() {
  // Ordre inverse des clés étrangères.
  await prisma.batch_Mouvement.deleteMany({
    where: {
      OR: [
        { id_lot: { in: ALL_LOTS } },
        { id_expedition: { in: ALL_SHIPMENTS } },
        { id_transformation: { in: ALL_TRANSFOS } },
      ],
    },
  });
  await prisma.liaison_Shipment.deleteMany({ where: { id_expedition: { in: ALL_SHIPMENTS } } });
  await prisma.shipment.deleteMany({ where: { id: { in: ALL_SHIPMENTS } } });
  await prisma.transformationComposition.deleteMany({
    where: { id_transformation: { in: ALL_TRANSFOS } },
  });
  await prisma.transformation.deleteMany({ where: { id: { in: ALL_TRANSFOS } } });
  await prisma.qualityControl.deleteMany({ where: { id_lot: { in: ALL_LOTS } } });
  await prisma.alert.deleteMany({
    where: { OR: [{ id: ID.alertFroid }, { related_id: { in: ALL_LOTS } }] },
  });
  await prisma.batch.deleteMany({ where: { id: { in: ALL_LOTS } } });
  await prisma.equipment.deleteMany({ where: { id: { in: ALL_EQUIP } } });
  await prisma.location.deleteMany({ where: { id: { in: ALL_LOCS } } });
}

async function purgeE2EResidue(orgId: string) {
  // Résidus des scripts e2e non nettoyés (Equipment/Location « E2E-* ») qui polluent
  // les écrans matériel / chaîne du froid.
  const e2eEquip = await prisma.equipment.findMany({
    where: { organization_id: orgId, nom: { startsWith: 'E2E-' } },
    select: { id: true },
  });
  const ids = e2eEquip.map((e) => e.id);
  if (ids.length) {
    // Détacher d'éventuels lots pointant dessus avant suppression.
    await prisma.batch.updateMany({
      where: { id_materiel_actuel: { in: ids } },
      data: { id_materiel_actuel: null },
    });
    await prisma.transformation.deleteMany({ where: { id_materiel: { in: ids } } });
    await prisma.equipment.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.location.deleteMany({
    where: { organization_id: orgId, nom: { startsWith: 'E2E-' } },
  });
  logger.info(`   nettoyage E2E : ${ids.length} matériel(s) + locations résiduels supprimés`);
}

async function main() {
  logger.info('🌱 Seed DÉMO — jeu de données riche…');

  const org = await prisma.organization.findUnique({ where: { slug: 'usine-laitiere-paris' } });
  if (!org) throw new Error('Org de base absente. Lance d’abord `npm run seed`.');
  const orgId = org.id;

  const member = await prisma.member.findFirst({
    where: { organizationId: orgId, role: { in: ['owner', 'admin'] } },
  });
  if (!member) throw new Error('Aucun member owner/admin. Lance d’abord `npm run seed`.');
  const userId = member.userId;

  const milk = await prisma.product.findFirst({
    where: { organization_id: orgId, nom: { contains: 'Lait 1L' } },
  });
  const butter = await prisma.product.findFirst({
    where: { organization_id: orgId, nom: { contains: 'Beurre' } },
  });
  const customer1 = await prisma.customer.findFirst({ where: { organization_id: orgId } });
  if (!milk || !butter || !customer1) throw new Error('Produits/client de base manquants.');

  await purgePreviousDemo();
  await purgeE2EResidue(orgId);

  // 1. Sites réels
  await prisma.location.createMany({
    data: [
      { id: ID.locReception, organization_id: orgId, nom: 'Quai de réception', type: 'RECEPTION' },
      { id: ID.locFroid, organization_id: orgId, nom: 'Chambre froide A', type: 'COLD_STORAGE' },
      {
        id: ID.locProduction,
        organization_id: orgId,
        nom: 'Ligne de conditionnement',
        type: 'PRODUCTION',
      },
    ],
  });

  // 2. Matériel (dont un frigo instrumenté en excursion)
  await prisma.equipment.createMany({
    data: [
      {
        id: ID.eqFrigo,
        organization_id: orgId,
        nom: 'Chambre froide A — groupe 1',
        type: 'FRIGO',
        id_lieu: ID.locFroid,
        statut: 'ALERTE',
        temp_actuelle: 7.4,
        temp_seuil_max: 4,
        sensor_id: 'SENSOR-FROID-A1',
      },
      {
        id: ID.eqCuve,
        organization_id: orgId,
        nom: 'Cuve de pasteurisation',
        type: 'CUVE',
        id_lieu: ID.locProduction,
        statut: 'PRET',
        temp_actuelle: 72,
      },
    ],
  });

  // 3. Produit matière première
  await prisma.product.upsert({
    where: { id: ID.prodLaitCru },
    update: {},
    create: {
      id: ID.prodLaitCru,
      organization_id: orgId,
      nom: 'Lait cru (matière première)',
      code_gtin: '3042040209789',
      categorie: 'Matière première',
      duree_conservation_defaut: 4,
      seuil_alerte_stock: 1000,
      unite_reference: 'L',
    },
  });

  // 4. Lots matière première (parents)
  await prisma.batch.createMany({
    data: [
      {
        id: ID.lotCruA,
        organization_id: orgId,
        lot_number: '260710-000101',
        id_produit: ID.prodLaitCru,
        quantite_actuelle: 2000,
        unite_code: 'L',
        quantite_base: 2000,
        date_peremption: day(4),
        statut: 'EN_STOCK',
        created_by: userId,
      },
      {
        id: ID.lotCruB,
        organization_id: orgId,
        lot_number: '260710-000102',
        id_produit: ID.prodLaitCru,
        quantite_actuelle: 1500,
        unite_code: 'L',
        quantite_base: 1500,
        date_peremption: day(4),
        statut: 'EN_STOCK',
        created_by: userId,
      },
      // Lots produits finis (enfants) — créés puis reliés par transformation
      {
        id: ID.lotLait,
        organization_id: orgId,
        lot_number: '260711-000201',
        id_produit: milk.id,
        quantite_actuelle: 3000,
        unite_code: 'L',
        quantite_base: 3000,
        date_peremption: day(30),
        statut: 'EN_STOCK',
        created_by: userId,
      },
      {
        id: ID.lotBeurre,
        organization_id: orgId,
        lot_number: '260711-000202',
        id_produit: butter.id,
        quantite_actuelle: 800,
        unite_code: 'kg',
        quantite_base: 200,
        date_peremption: day(90),
        statut: 'EN_STOCK',
        created_by: userId,
      },
      // Lot en quarantaine (contrôle non conforme)
      {
        id: ID.lotQuarantaine,
        organization_id: orgId,
        lot_number: '260709-000099',
        id_produit: butter.id,
        quantite_actuelle: 120,
        unite_code: 'kg',
        quantite_base: 30,
        date_peremption: day(60),
        statut: 'BLOQUE',
        created_by: userId,
      },
    ],
  });

  // 5. Transformations (généalogie) : A+B → Lait ; A → Beurre
  await prisma.transformation.create({
    data: {
      id: ID.transfoLait,
      id_lot_enfant: ID.lotLait,
      id_produit_fini: milk.id,
      id_user: userId,
      id_materiel: ID.eqCuve,
      statut: 'TERMINE',
      compositions: {
        create: [
          { id_lot_parent: ID.lotCruA, quantite_prelevee: 1800, unite: 'L', lot_parent_epuise: false },
          { id_lot_parent: ID.lotCruB, quantite_prelevee: 1200, unite: 'L', lot_parent_epuise: false },
        ],
      },
    },
  });
  await prisma.transformation.create({
    data: {
      id: ID.transfoBeurre,
      id_lot_enfant: ID.lotBeurre,
      id_produit_fini: butter.id,
      id_user: userId,
      id_materiel: ID.eqCuve,
      statut: 'TERMINE',
      compositions: {
        create: [
          { id_lot_parent: ID.lotCruA, quantite_prelevee: 200, unite: 'L', lot_parent_epuise: false },
        ],
      },
    },
  });

  // 6. Deuxième client + expéditions (lots finis livrés)
  await prisma.customer.upsert({
    where: { id: ID.customer2 },
    update: {},
    create: {
      id: ID.customer2,
      organization_id: orgId,
      nom_enseigne: 'Épicerie du Marché',
      email: 'contact@epicerie-marche.example',
      adresse_livraison: '12 place du Marché, 69001 Lyon',
    },
  });
  await prisma.shipment.create({
    data: {
      id: ID.shipLait,
      organization_id: orgId,
      id_client: customer1.id,
      shipment_id: '340123450000000017',
      date_envoi: day(-1),
      transporteur: 'TransFroid Express',
      statut_livraison: 'LIVRE',
      created_by: userId,
      liaisons: { create: { id_lot: ID.lotLait, quantite_expediee: 1500, unite: 'L' } },
    },
  });
  await prisma.shipment.create({
    data: {
      id: ID.shipBeurre,
      organization_id: orgId,
      id_client: ID.customer2,
      shipment_id: '340123450000000024',
      date_envoi: day(-1),
      transporteur: 'TransFroid Express',
      statut_livraison: 'EN_TRANSIT',
      created_by: userId,
      liaisons: { create: { id_lot: ID.lotBeurre, quantite_expediee: 400, unite: 'kg' } },
    },
  });

  // 7. Mouvements de lots (réception, transformation, expédition)
  await prisma.batch_Mouvement.createMany({
    data: [
      { id_lot: ID.lotCruA, type_action: 'RECEPTION', quantite: 2000, unite: 'L', id_user: userId },
      { id_lot: ID.lotCruB, type_action: 'RECEPTION', quantite: 1500, unite: 'L', id_user: userId },
      {
        id_lot: ID.lotLait,
        type_action: 'TRANSFORMATION',
        quantite: 3000,
        unite: 'L',
        id_transformation: ID.transfoLait,
        id_user: userId,
      },
      {
        id_lot: ID.lotBeurre,
        type_action: 'TRANSFORMATION',
        quantite: 800,
        unite: 'kg',
        id_transformation: ID.transfoBeurre,
        id_user: userId,
      },
      {
        id_lot: ID.lotLait,
        type_action: 'EXPEDITION',
        quantite: 1500,
        unite: 'L',
        id_expedition: ID.shipLait,
        id_user: userId,
      },
    ],
  });

  // 8. Contrôles qualité (1 conforme, 1 non conforme sur le lot en quarantaine)
  await prisma.qualityControl.createMany({
    data: [
      {
        organization_id: orgId,
        id_lot: ID.lotLait,
        type_test: 'Analyse microbiologique',
        resultat: 'CONFORME',
        id_user_labo: userId,
        date_test: day(-1),
        notes: 'Listeria négatif, flore totale conforme.',
      },
      {
        organization_id: orgId,
        id_lot: ID.lotQuarantaine,
        type_test: 'Analyse microbiologique',
        resultat: 'NON_CONFORME — QUARANTAINE',
        id_user_labo: userId,
        date_test: day(-2),
        notes: 'Dépassement flore totale — lot bloqué.',
      },
    ],
  });

  // 9. Alerte chaîne du froid ACTIVE (type réel émis par l'API)
  await prisma.alert.create({
    data: {
      id: ID.alertFroid,
      organization_id: orgId,
      type: 'TEMP_EXCURSION',
      niveau_gravite: 'CRITIQUE',
      message: 'Excursion température Chambre froide A — 7,4 °C (seuil 4 °C) depuis 12 min.',
      id_materiel: ID.eqFrigo,
      statut: 'ACTIVE',
    },
  });

  logger.info('✅ Seed DÉMO terminé.');
  logger.info('   3 sites, 2 matériels, généalogie A+B→Lait / A→Beurre, 2 expéditions,');
  logger.info('   2 contrôles qualité, 1 lot en quarantaine, 1 alerte froid active.');
  logger.info(`   Rappel de démo à déclencher sur le lot ${ID.lotCruA} (bloque Lait + Beurre).`);
}

main()
  .catch((e) => {
    console.error(e);
    logger.error('❌ Seed démo échoué:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
