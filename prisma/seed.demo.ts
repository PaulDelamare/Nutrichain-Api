/**
 * Seed de DÉMONSTRATION — jeu de données riche et cohérent pour la démonstration.
 *
 * S'ajoute par-dessus le seed de base (`prisma/seed.ts`) : réutilise l'organisation,
 * l'admin, le fournisseur et le client seedés, et construit une chaîne complète
 * matière → transformation → produit fini → expédition, plus des sites réels, du
 * matériel avec capteurs, des contrôles qualité et un lot en quarantaine. Objectif :
 * que Traçabilité, Rappels, Généalogie, etc. ne soient plus vides en démo.
 *
 * Il ne pose AUCUNE alerte froid : elle se fabrique par `npm run simulate:sensor`,
 * qui laisse la détection la produire (cf. étape 7).
 *
 * Les lots, réceptions, transformations et expéditions passent PAR LES SERVICES
 * métier (receiptService, transformationService, qualityControlService,
 * shipmentService, batchService) — jamais par une écriture Prisma directe. C'est ce
 * qui fait exister le magasin d'événements EPCIS et les Receipt en démo : un seed qui
 * écrit en direct ne produit ni l'un ni l'autre, quel que soit le code réellement
 * exécuté en production (cf. issue #72).
 *
 * Conséquence : Batch/Transformation/Shipment reçoivent leur id du SERVEUR (uuid), pas
 * d'un id figé — les services ne prennent pas cet id en paramètre, et il n'y a aucune
 * raison de le leur ajouter pour un seed. L'idempotence (purge avant recréation) se fait
 * donc par CLÉ MÉTIER qu'on contrôle (numéro de lot, numéro de bon de réception, numéro
 * d'expédition, matériel de la cuve), pas par UUID — même principe que `purgeE2EResidue`
 * ci-dessous. Plusieurs clés, et non une seule : elles n'ont pas toutes le même âge, et la
 * purge doit reconnaître un jeu de données écrit par une version antérieure du seed.
 *
 * Lancement : npm run seed:demo   (après `npx prisma db seed`)
 */
import 'dotenv/config';
import { prisma } from '../src/shared/configs/prismaClient.config';
import { logger } from '../src/shared/utils/logger/logger';
import { receiptService } from '../src/modules/logistics/receipts/services/receipt.service';
import { transformationService } from '../src/modules/traceability/transformations/services/transformation.service';
import { qualityControlService } from '../src/modules/organization/services/qualityControl.service';
import { batchService } from '../src/modules/logistics/shared/services/batch.service';
import { shipmentService } from '../src/modules/logistics/shipments/services/shipment.service';
import { QUALITY_RESULTS, RECEIPT_STATUSES } from '../src/modules/logistics/constants/logistics.constants';

// IDs fixes UNIQUEMENT pour ce que le seed crée lui-même en direct (sites, matériel,
// produit matière première, second client) : aucun de ces modèles n'est
// couvert par l'issue #72, et un id figé y reste le moyen le plus simple de rester
// idempotent (cf. règle YAGNI — ne pas réinventer une clé métier là où il en existe déjà une).
const ID = {
  locReception: 'd0000000-0000-4000-8000-000000000001',
  locFroid: 'd0000000-0000-4000-8000-000000000002',
  locProduction: 'd0000000-0000-4000-8000-000000000003',
  eqFrigo: 'd0000000-0000-4000-8000-000000000011',
  eqCuve: 'd0000000-0000-4000-8000-000000000012',
  eqRack: 'd0000000-0000-4000-8000-000000000013',
  eqFroidSain: 'd0000000-0000-4000-8000-000000000014',
  prodLaitCru: 'd0000000-0000-4000-8000-000000000021',
  customer2: 'd0000000-0000-4000-8000-000000000061',
  // Le seed ne pose plus cette alerte (cf. étape 7), mais l'identifiant reste : la purge doit
  // continuer à retirer celle que les exécutions précédentes ont laissée en base.
  alertFroid: 'd0000000-0000-4000-8000-000000000071',
};

// Clés métier des lots/réceptions/expéditions créés PAR LES SERVICES — c'est par elles
// qu'on retrouve et purge les données de démo d'une exécution à l'autre, pas par un id.
const RECEIPT_BONS = ['DEMO-BON-LIVRAISON-A', 'DEMO-BON-LIVRAISON-B'];
const SHIPMENT_IDS = ['340123450000000017', '340123450000000024'];

/**
 * Numéros de lot des deux réceptions de démo. Source unique : ils servent à la fois à CRÉER les
 * lots et à les RETROUVER pour les purger.
 *
 * Ils sont aussi le seul repère qui n'a pas bougé d'une version du seed à l'autre — ce qui les rend
 * indispensables à la purge (voir `purgePreviousDemo`).
 */
const DEMO_LOT_NUMBERS = ['260710-000101', '260710-000102'];

const day = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

/**
 * Purge la précédente exécution du seed démo, en retrouvant les lignes créées par les
 * services via leur clé métier (bons de réception, numéros d'expédition, matériel de la
 * cuve) — les UUID de Batch/Transformation/Shipment ne sont pas connus à l'avance,
 * puisque ce sont désormais les services qui les génèrent.
 */
async function purgePreviousDemo(orgId: string) {
  // DEUX chemins de découverte, et il en faut deux.
  //
  // 1. Le bon de réception retrouve ce que la version COURANTE du seed a écrit.
  // 2. Le numéro de lot retrouve ce qu'une version ANTÉRIEURE a écrit. Ces numéros n'ont pas changé
  //    depuis juillet, alors que la clé de réception est arrivée avec le passage du seed par les
  //    services métier : un volume plus ancien que ce changement contient donc des lots que le
  //    premier chemin ne voit pas. La purge ne supprimait rien, la recréation heurtait
  //    `@@unique([organization_id, lot_number])`, et le seed sortait en 409 sur un message qui ne
  //    parle que d'un numéro de lot.
  //
  // Ce n'était pas un défaut d'idempotence — deux exécutions consécutives de la MÊME version
  // passent — mais un défaut de compatibilité avec les jeux de données déjà en place. Le prix était
  // pourtant maximal : le service `api` du compose attend `seed: service_completed_successfully`,
  // donc TOUTE la pile cessait de démarrer, et un `docker compose down && up` ne la relevait plus.
  const [receiptsCourants, lotsHistoriques] = await Promise.all([
    prisma.receipt.findMany({
      where: { organization_id: orgId, shipment_id: { in: RECEIPT_BONS } },
      select: { id: true },
    }),
    prisma.batch.findMany({
      where: { organization_id: orgId, lot_number: { in: DEMO_LOT_NUMBERS } },
      select: { id: true, id_receipt: true },
    }),
  ]);

  const receiptIds = Array.from(
    new Set([
      ...receiptsCourants.map((r) => r.id),
      // Purger le lot sans sa réception laisserait un bon orphelin dans l'écran Réceptions.
      ...lotsHistoriques.map((b) => b.id_receipt).filter((id): id is string => id !== null),
    ])
  );

  const receiptBatches = await prisma.batch.findMany({
    where: { id_receipt: { in: receiptIds } },
    select: { id: true },
  });
  const lotsIdentifies = Array.from(
    new Set([...receiptBatches.map((b) => b.id), ...lotsHistoriques.map((b) => b.id)])
  );

  // `Transformation` ne porte pas `organization_id` en colonne propre : le cloisonnement passe par
  // le lot enfant qu'elle a produit (`lot_enfant.organization_id`), pas par un filtre absent.
  // On la retrouve par sa cuve, mais aussi par les lots déjà identifiés — en parent comme en
  // enfant — car une version antérieure a pu transformer depuis un autre matériel.
  const transformations = await prisma.transformation.findMany({
    where: {
      OR: [
        { id_materiel: ID.eqCuve, lot_enfant: { organization_id: orgId } },
        { id_lot_enfant: { in: lotsIdentifies } },
        { compositions: { some: { id_lot_parent: { in: lotsIdentifies } } } },
      ],
    },
    select: { id: true, id_lot_enfant: true },
  });
  const transformationIds = transformations.map((t) => t.id);

  const batchIds = Array.from(
    new Set([...lotsIdentifies, ...transformations.map((t) => t.id_lot_enfant)])
  );

  const shipments = await prisma.shipment.findMany({
    where: { organization_id: orgId, shipment_id: { in: SHIPMENT_IDS } },
    select: { id: true },
  });
  const shipmentIds = shipments.map((s) => s.id);

  // Les événements EPCIS ne portent aucune clé étrangère vers ces lignes (`related_entity` +
  // `related_id`, texte libre indexé) : ils ne bloquaient donc pas la purge, ils s'ACCUMULAIENT.
  // Chaque exécution du seed en rajoutait un jeu complet sans retirer le précédent — 10 après la
  // première, 50 après cinq — et le journal EPCIS affichait cinq fois la même réception. Ce n'est
  // pas cosmétique en démonstration : la conformité GS1 est l'argument central du dossier, et le
  // compteur d'événements est ce qu'on projette.
  await prisma.ePCIS_Event.deleteMany({
    where: {
      organization_id: orgId,
      related_id: { in: [...receiptIds, ...transformationIds, ...shipmentIds] },
    },
  });

  // Ordre inverse des clés étrangères.
  await prisma.batch_Mouvement.deleteMany({
    where: {
      OR: [
        { id_lot: { in: batchIds } },
        { id_expedition: { in: shipmentIds } },
        { id_transformation: { in: transformationIds } },
      ],
    },
  });
  await prisma.liaison_Shipment.deleteMany({ where: { id_expedition: { in: shipmentIds } } });
  await prisma.qualityControl.deleteMany({ where: { id_lot: { in: batchIds } } });
  await prisma.transformationComposition.deleteMany({
    where: { id_transformation: { in: transformationIds } },
  });
  await prisma.transformation.deleteMany({ where: { id: { in: transformationIds } } });
  // Les excursions thermiques de l'organisation partent AUSSI, y compris celles qu'une vraie
  // détection a produites : ce seed est documenté comme rejouable, or leurs lots viennent d'être
  // supprimés ci-dessus. Les laisser afficherait des alertes critiques sans courbe ni lot impacté.
  //
  // ⚠️ SAUF celles qui retiennent encore un lot hors périmètre de démonstration — typiquement un lot
  // créé à la main pendant une répétition, rangé dans le frigo, puis bloqué par `simulate:sensor`.
  // Supprimer leur alerte laisserait le lot `BLOQUE` avec un `id_alerte` mort : plus aucun écran
  // n'expliquerait son blocage, et `GET /alerts/:id/batches` répondrait 404 sur sa cause. Ce serait
  // le même écran incohérent, simplement retourné — un lot sans incident au lieu d'un incident sans
  // lot. La levée d'une quarantaine étant une décision qualité, un seed ne la prend pas à la place
  // d'un humain : on garde l'alerte.
  //
  // Les mouvements des lots de démonstration sont déjà supprimés plus haut : tout
  // `QUARANTAINE_FROID` encore présent désigne donc, par construction, un lot hors périmètre.
  const heldElsewhere = await prisma.batch_Mouvement.findMany({
    where: { type_action: 'QUARANTAINE_FROID' },
    select: { metadata: true },
  });
  const stillHolding = new Set(
    heldElsewhere
      .map((movement) => (movement.metadata as { id_alerte?: string } | null)?.id_alerte)
      .filter((id): id is string => typeof id === 'string')
  );

  await prisma.alert.deleteMany({
    where: {
      id: { notIn: [...stillHolding] },
      // Cloisonné par organisation : aucun autre tenant n'est touché.
      OR: [
        { id: ID.alertFroid },
        { related_id: { in: batchIds } },
        { organization_id: orgId, type: 'TEMP_EXCURSION' },
      ],
    },
  });
  await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
  // `ScrapRecord` référence `Batch` en RESTRICT : un lot mis au rebut entre deux exécutions bloquait
  // la purge, sans que la table figure dans cette liste — elle est arrivée après elle.
  await prisma.scrapRecord.deleteMany({ where: { id_lot: { in: batchIds } } });
  await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.receipt.deleteMany({ where: { id: { in: receiptIds } } });
  // ⚠️ Matériels et sites NE SONT PAS supprimés : d'autres lots (réceptions réelles, e2e) les
  // référencent, la clé étrangère est en RESTRICT, et le seed mourait au milieu de sa purge —
  // après avoir déjà effacé les lots de démo. Ils ont des identifiants fixes : on les RÉÉCRIT.
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
  // Ce seed ne crée aucun compte : la garde ne ferme donc pas de faille, elle aligne le seed de
  // démonstration sur celui de base (`seed.ts`), qui refuse déjà la production. Sans elle, la
  // moitié « données » d'un jeu de démonstration reste injectable là où la moitié « comptes »
  // est refusée — et c'est le genre d'écart qu'on ne remarque qu'une fois les données en place.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Ce seed de démonstration ne doit jamais tourner en production : il injecte un jeu de ' +
        `données fictif (lots, expéditions, alertes). NODE_ENV="${process.env.NODE_ENV}".`
    );
  }

  logger.info('🌱 Seed DÉMO — jeu de données riche…');

  const org = await prisma.organization.findUnique({ where: { slug: 'usine-laitiere-paris' } });
  if (!org) throw new Error('Org de base absente. Lance d’abord `npm run seed`.');
  const orgId = org.id;

  const member = await prisma.member.findFirst({
    where: { organizationId: orgId, role: { in: ['owner', 'admin'] } },
  });
  if (!member) throw new Error('Aucun member owner/admin. Lance d’abord `npm run seed`.');
  const userId = member.userId;

  // Les lots sont PRODUITS par l'opérateur, pas par l'administrateur qui fera la démonstration.
  // Sans cela, la levée de quarantaine de l'étape 5 du scénario est refusée en 403 : on ne libère
  // pas sa propre production (séparation des tâches HACCP). Le contrôle qualité qui libère les
  // lots de démo est donc signé par `userId` (l'admin), jamais par `producerId`, pour la même
  // raison — cf. `enforceSeparationOfDuties`.
  //
  // On vise le compte de démonstration NOMMÉ, pas « un opérateur » : un `findFirst` sur le rôle
  // désignait au hasard n'importe quel opérateur de l'organisation — y compris un compte personnel
  // ou un résidu de test e2e — et le jeu de démonstration cessait d'être reproductible.
  const demoOperator = await prisma.user.findFirst({
    where: {
      email: 'operator@nutrichain.local',
      // `Batch.created_by` est une FK vers `User` SANS contrainte d'organisation : sans ce filtre,
      // le seed pourrait attribuer une production à quelqu'un d'extérieur au tenant.
      members: { some: { organizationId: orgId } },
    },
    select: { id: true },
  });
  const producerId = demoOperator?.id ?? userId;
  if (!demoOperator) {
    logger.warn(
      '   ⚠️ Compte operator@nutrichain.local absent : les lots sont attribués à l’administrateur, ' +
        'et la levée de quarantaine de démo sera refusée (403). Relance `npx prisma db seed`.'
    );
  }

  const supplier = await prisma.supplier.findFirst({ where: { organization_id: orgId } });
  const milk = await prisma.product.findFirst({
    where: { organization_id: orgId, nom: { contains: 'Lait 1L' } },
  });
  const butter = await prisma.product.findFirst({
    where: { organization_id: orgId, nom: { contains: 'Beurre' } },
  });
  const customer1 = await prisma.customer.findFirst({ where: { organization_id: orgId } });
  if (!milk || !butter || !customer1 || !supplier) {
    throw new Error('Produits/client/fournisseur de base manquants.');
  }

  await purgePreviousDemo(orgId);
  await purgeE2EResidue(orgId);

  // 1. Sites réels. Les coordonnées sont celles du plan d'usine (trois points distincts du même
  // site parisien) : c'est la SEULE source du repère de la fiche lot, que le front devinait
  // auparavant par regex sur le nom du lieu (cf. #23).
  const locations = [
    {
      id: ID.locReception,
      organization_id: orgId,
      nom: 'Quai de réception',
      type: 'RECEPTION',
      latitude: 48.83291,
      longitude: 2.28654,
    },
    {
      id: ID.locFroid,
      organization_id: orgId,
      nom: 'Chambre froide A',
      type: 'COLD_STORAGE',
      latitude: 48.83318,
      longitude: 2.28691,
    },
    {
      id: ID.locProduction,
      organization_id: orgId,
      nom: 'Ligne de conditionnement',
      type: 'PRODUCTION',
      latitude: 48.83345,
      longitude: 2.287281,
    },
  ];
  for (const loc of locations) {
    await prisma.location.upsert({ where: { id: loc.id }, update: loc, create: loc });
  }

  // 2. Matériel (dont un frigo instrumenté en excursion)
  const equipements = [
    {
      id: ID.eqRack,
      organization_id: orgId,
      nom: 'Rack de réception',
      type: 'ETAGERE',
      id_lieu: ID.locReception,
      statut: 'PRET',
      // Étiquette scannable posée dès le seed (le GET ne la génère plus — cf. #99).
      qr_code_id: 'EQP-DEMORACK01',
    },
    {
      id: ID.eqFroidSain,
      organization_id: orgId,
      nom: 'Chambre froide A — groupe 1',
      type: 'FRIGO',
      id_lieu: ID.locFroid,
      statut: 'PRET',
      temp_actuelle: 3.2,
      temp_seuil_max: 4,
      sensor_id: 'SENSOR-FROID-A1',
      qr_code_id: 'EQP-DEMOFROID1',
    },
    {
      id: ID.eqFrigo,
      organization_id: orgId,
      nom: 'Chambre froide A — groupe 2',
      type: 'FRIGO',
      id_lieu: ID.locFroid,
      statut: 'ALERTE',
      temp_actuelle: 7.4,
      temp_seuil_max: 4,
      sensor_id: 'SENSOR-FROID-A2',
      qr_code_id: 'EQP-DEMOFROID2',
    },
    {
      id: ID.eqCuve,
      organization_id: orgId,
      nom: 'Cuve de pasteurisation',
      type: 'CUVE',
      id_lieu: ID.locProduction,
      statut: 'PRET',
      temp_actuelle: 72,
      qr_code_id: 'EQP-DEMOCUVE01',
    },
  ];
  for (const eq of equipements) {
    await prisma.equipment.upsert({ where: { id: eq.id }, update: eq, create: eq });
  }

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

  // 4. Réceptions de matière première (Receipt + Batch + EPCIS ObjectEvent, via le service réel)
  const receptionA = await receiptService.createReceipt({
    organization_id: orgId,
    id_fournisseur: supplier.id,
    id_produit: ID.prodLaitCru,
    shipment_id: RECEIPT_BONS[0],
    statut_controle: RECEIPT_STATUSES.OK,
    received_by: producerId,
    quantite_actuelle: 2000,
    unite_code: 'L',
    id_materiel: ID.eqRack,
    lot_number: DEMO_LOT_NUMBERS[0],
    date_peremption: day(4).toISOString().slice(0, 10),
  });
  const receptionB = await receiptService.createReceipt({
    organization_id: orgId,
    id_fournisseur: supplier.id,
    id_produit: ID.prodLaitCru,
    shipment_id: RECEIPT_BONS[1],
    statut_controle: RECEIPT_STATUSES.OK,
    received_by: producerId,
    quantite_actuelle: 1500,
    unite_code: 'L',
    id_materiel: ID.eqRack,
    lot_number: DEMO_LOT_NUMBERS[1],
    date_peremption: day(4).toISOString().slice(0, 10),
  });
  const lotCruA = receptionA.batchId;
  const lotCruB = receptionB.batchId;

  // 5. Transformations (généalogie) : B(300L) → Lait attente QC (300L), A(1700L)+B(1200L) → Lait
  // en stock (2900L), A(200L) → Beurre en stock, A(100L) → Beurre non conforme (quarantaine).
  // Chaque transformation naît PENDING_QC (barrière qualité) — c'est `qualityControlService`,
  // pas la transformation, qui décide de la libérer ou de la bloquer.
  //
  // `lot_parent_epuise` ne vaut `true` que sur la DERNIÈRE consommation d'un lot parent donné :
  // le poser plus tôt marque le lot EPUISE alors qu'il lui reste du stock, un état auto-contradictoire
  // qui se scelle tel quel dans l'audit WORM (`TRANSFORM_CONSUME`). lotCruA est consommé par 3 appels
  // (transfoLait, transfoBeurre, transfoQuarantaine, dans cet ordre) : seul le dernier l'épuise.
  // lotCruB n'est consommé que par 2 appels (transfoAttenteQc, puis transfoLait) : seul le second.

  // Lot fraîchement transformé : il ATTEND son contrôle de sortie d'usine. Barrière qualité :
  // il n'est ni expédiable ni transformable tant qu'un contrôle ne l'a pas libéré. C'est l'état
  // nominal d'un produit fini qui vient d'être produit — aucun contrôle n'est déclenché ici.
  const transfoAttenteQc = await transformationService.createTransformation({
    organization_id: orgId,
    id_produit_fini: milk.id,
    id_materiel: ID.eqCuve,
    quantite_produite: 300,
    unite_code: 'L',
    date_peremption: day(28),
    created_by: producerId,
    inputs: [{ id_lot_parent: lotCruB, quantite_prelevee: 300, unite: 'L', lot_parent_epuise: false }],
  });
  await batchService.moveBatch(transfoAttenteQc.lot_enfant_id, orgId, producerId, ID.eqFroidSain);

  const transfoLait = await transformationService.createTransformation({
    organization_id: orgId,
    id_produit_fini: milk.id,
    id_materiel: ID.eqCuve,
    quantite_produite: 2900,
    unite_code: 'L',
    date_peremption: day(30),
    created_by: producerId,
    inputs: [
      { id_lot_parent: lotCruA, quantite_prelevee: 1700, unite: 'L', lot_parent_epuise: false },
      { id_lot_parent: lotCruB, quantite_prelevee: 1200, unite: 'L', lot_parent_epuise: true },
    ],
  });
  await batchService.moveBatch(transfoLait.lot_enfant_id, orgId, producerId, ID.eqFroidSain);
  await qualityControlService.createQualityControl({
    organization_id: orgId,
    id_lot: transfoLait.lot_enfant_id,
    type_test: 'Analyse microbiologique',
    resultat: QUALITY_RESULTS.CONFORM,
    id_user_labo: userId,
    notes: 'Listeria négatif, flore totale conforme.',
  });

  const transfoBeurre = await transformationService.createTransformation({
    organization_id: orgId,
    id_produit_fini: butter.id,
    id_materiel: ID.eqCuve,
    quantite_produite: 800,
    unite_code: 'KG',
    date_peremption: day(90),
    created_by: producerId,
    inputs: [{ id_lot_parent: lotCruA, quantite_prelevee: 200, unite: 'L', lot_parent_epuise: false }],
  });
  await batchService.moveBatch(transfoBeurre.lot_enfant_id, orgId, producerId, ID.eqFroidSain);
  // Le beurre a été EXPÉDIÉ (§6) : il ne peut l'avoir été que parce qu'un contrôle l'a libéré.
  // Sans cet appel, la démo contredirait la barrière qualité qu'elle est censée illustrer.
  await qualityControlService.createQualityControl({
    organization_id: orgId,
    id_lot: transfoBeurre.lot_enfant_id,
    type_test: 'Analyse microbiologique',
    resultat: QUALITY_RESULTS.CONFORM,
    id_user_labo: userId,
    notes: 'Conforme — lot libéré pour expédition.',
  });

  // Lot en quarantaine : produit fini non conforme à son contrôle de sortie. Déplacé dans le
  // frigo EN ALERTE avant le verdict — un lot BLOQUE n'est plus déplaçable (cf. `moveBatch`).
  const transfoQuarantaine = await transformationService.createTransformation({
    organization_id: orgId,
    id_produit_fini: butter.id,
    id_materiel: ID.eqCuve,
    quantite_produite: 40,
    unite_code: 'KG',
    date_peremption: day(60),
    created_by: producerId,
    inputs: [{ id_lot_parent: lotCruA, quantite_prelevee: 100, unite: 'L', lot_parent_epuise: true }],
  });
  await batchService.moveBatch(transfoQuarantaine.lot_enfant_id, orgId, producerId, ID.eqFrigo);
  await qualityControlService.createQualityControl({
    organization_id: orgId,
    id_lot: transfoQuarantaine.lot_enfant_id,
    type_test: 'Analyse microbiologique',
    resultat: QUALITY_RESULTS.NON_CONFORM,
    id_user_labo: userId,
    notes: 'Dépassement flore totale — lot bloqué.',
  });
  const lotQuarantaine = transfoQuarantaine.lot_enfant_id;

  // 6. Deuxième client + expéditions (lots finis livrés, via le service réel : EPCIS
  // ObjectEvent + AggregationEvent, mouvement, audit).
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
  const shipLait = await shipmentService.createShipment({
    organization_id: orgId,
    id_client: customer1.id,
    shipment_id: SHIPMENT_IDS[0],
    transporteur: 'TransFroid Express',
    date_envoi: day(-1),
    created_by: userId,
    items: [{ id_lot: transfoLait.lot_enfant_id, quantite: 1500 }],
  });
  const shipBeurre = await shipmentService.createShipment({
    organization_id: orgId,
    id_client: ID.customer2,
    shipment_id: SHIPMENT_IDS[1],
    transporteur: 'TransFroid Express',
    date_envoi: day(-1),
    created_by: userId,
    items: [{ id_lot: transfoBeurre.lot_enfant_id, quantite: 400 }],
  });
  // Une expédition livrée, l'autre encore en route : c'est ce contraste qui rend lisible l'impact
  // d'un rappel. On passe par le SERVICE et non par une mise à jour directe — le statut écrit à la
  // main laissait une expédition « livrée » sans date ni auteur, un état que la base refuse
  // désormais, et qui faisait afficher au rappel une information invérifiable. `EN_TRANSIT`, qui
  // traînait ici, n'a jamais fait partie du vocabulaire.
  // Sans date explicite : le seed crée les expéditions à l'instant, et la garde refuse — à raison —
  // une arrivée antérieure au départ. Une livraison antidatée exigerait d'antidater l'expédition.
  await shipmentService.confirmDelivery(shipLait.id, orgId, { userId });

  // 7. Aucune alerte froid n'est posée ici, à dessein.
  //
  // Une `Alert` écrite à la main est un fait que le système prétend DÉRIVER : `peak_temp` et
  // `temp_seuil` restaient vides faute de détection, aucun `QUARANTAINE_FROID` ne la rattachait à un
  // lot, et aucune télémétrie ne la précédait. L'écran affichait donc « incident critique » avec une
  // colonne « lots impactés » à `—` et pas de courbe — l'inverse exact de ce que la surveillance
  // promet. Elle brouillait de surcroît sa propre démonstration : on annonce une alerte qui naît en
  // direct devant une alerte déjà là, sans rien derrière elle.
  //
  // La vraie alerte se fabrique par `npm run simulate:sensor`, qui joue le thermomètre sur le
  // capteur du groupe 1 : la détection calcule le pic, bloque les lots rangés là et scelle le
  // journal. Semer de la télémétrie serait légitime — c'est une entrée brute ; semer sa conclusion
  // ne l'est pas.

  logger.info('✅ Seed DÉMO terminé.');
  logger.info(
    '   3 sites, 4 matériels, lots rattachés à leur emplacement, généalogie A+B→Lait / A→Beurre,'
  );
  logger.info('   2 expéditions, 3 contrôles qualité, 1 lot en quarantaine.');
  logger.info('   Chaîne du froid : aucune alerte — `npm run simulate:sensor` la fait naître.');
  logger.info(`   Rappel de démo à déclencher sur le lot ${lotCruA} (bloque Lait + Beurre).`);
  logger.info(`   Lot en quarantaine (contrôle non conforme) : ${lotQuarantaine}`);
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
