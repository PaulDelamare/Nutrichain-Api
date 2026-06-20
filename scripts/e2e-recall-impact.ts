/**
 * E2E — recall produit avec identification des expéditions impactées.
 *
 * Valide la vraie chaîne Postgres + Prisma + transaction Serializable + audit WORM
 * en appelant directement `recallService.triggerRecall` (la couche HTTP/auth est triviale
 * et couverte par les tests Vitest avec supertest).
 *
 * Pré-requis :
 * - DB Postgres up + migrations + seed (`npx prisma db seed`)
 * - .env contient API_KEY_ORG_ID="usine-laitiere-paris"
 *
 * Lancement : npm run e2e:recall
 *
 * Scénarios couverts :
 *  1. Setup : créer 2 lots (source + enfant via transformation) + 1 shipment lié à l'enfant
 *  2. Trigger recall sur le lot source → vérifier blocage + affectedShipments
 *  3. Vérifier audit WORM enrichi (action='BATCH_RECALL_TRIGGERED' + newValue.affectedShipmentsCount + shipmentRefs)
 *  4. Cleanup des fixtures créées
 */
import { prisma } from '../src/shared/configs/prismaClient.config';
import { recallService } from '../src/modules/traceability/transformations/services/recall.service';

const ORG_ID = process.env.API_KEY_ORG_ID;
if (!ORG_ID) {
  console.error('[E2E] API_KEY_ORG_ID requis dans .env');
  process.exit(1);
}

const failures: string[] = [];
function assert(condition: boolean, label: string) {
  if (!condition) {
    failures.push(label);
    console.error(`  ❌ ${label}`);
  } else {
    console.log(`  ✅ ${label}`);
  }
}

interface Fixtures {
  sourceBatchId: string;
  childBatchId: string;
  shipmentId: string;
  customerId: string;
  customerName: string;
  shipmentRef: string;
  userId: string;
  transformationId: string;
  locationId: string;
  equipmentId: string;
}

async function setup(): Promise<Fixtures> {
  console.log('\n[E2E] Setup des fixtures...');

  // 1. Récupérer un user membre + un produit existant dans l'org seedée
  const member = await prisma.member.findFirst({ where: { organizationId: ORG_ID! } });
  const product = await prisma.product.findFirst({ where: { organization_id: ORG_ID! } });
  if (!member || !product) {
    throw new Error('Pas de member ou de product seedé pour cette org.');
  }

  // 2. Créer un Customer dédié à ce test
  const stamp = Date.now();
  const customer = await prisma.customer.create({
    data: {
      organization_id: ORG_ID!,
      nom_enseigne: `E2E-Customer-${stamp}`,
      contact_urgence: '+33000000000',
      adresse_livraison: 'E2E test address',
    },
  });

  // 3. Créer le lot source
  const sourceBatch = await prisma.batch.create({
    data: {
      organization_id: ORG_ID!,
      id_produit: product.id,
      quantite_actuelle: 100,
      unite_code: product.unite_reference,
      quantite_base: 100,
      statut: 'EN_STOCK',
      created_by: member.userId,
    },
  });

  // 4. Créer un lot enfant via une Transformation
  const childBatch = await prisma.batch.create({
    data: {
      organization_id: ORG_ID!,
      id_produit: product.id,
      quantite_actuelle: 50,
      unite_code: product.unite_reference,
      quantite_base: 50,
      statut: 'EN_STOCK',
      created_by: member.userId,
    },
  });

  // Equipment requis par Transformation — création locale si non seedé
  let location = await prisma.location.findFirst({ where: { organization_id: ORG_ID! } });
  if (!location) {
    location = await prisma.location.create({
      data: { organization_id: ORG_ID!, nom: `E2E-Location-${stamp}`, type: 'WAREHOUSE' },
    });
  }
  let equipment = await prisma.equipment.findFirst({ where: { organization_id: ORG_ID! } });
  if (!equipment) {
    equipment = await prisma.equipment.create({
      data: {
        organization_id: ORG_ID!,
        nom: `E2E-Equipment-${stamp}`,
        type: 'MIXER',
        id_lieu: location.id,
      },
    });
  }

  const transformation = await prisma.transformation.create({
    data: {
      id_lot_enfant: childBatch.id,
      id_produit_fini: product.id,
      id_user: member.userId,
      id_materiel: equipment.id,
      statut: 'TERMINE',
      compositions: {
        create: {
          id_lot_parent: sourceBatch.id,
          quantite_prelevee: 50,
          unite: product.unite_reference,
          lot_parent_epuise: false,
        },
      },
    },
  });

  // 5. Créer un Shipment + Liaison_Shipment pointant vers le LOT ENFANT
  //    (pour prouver que le recall remonte via getDownstream)
  const shipment = await prisma.shipment.create({
    data: {
      organization_id: ORG_ID!,
      id_client: customer.id,
      shipment_id: `E2E-RECALL-${stamp}`,
      date_envoi: new Date(),
      transporteur: 'E2E Transporteur',
      statut_livraison: 'LIVRE',
      created_by: member.userId,
      liaisons: {
        create: {
          id_lot: childBatch.id,
          quantite_expediee: 50,
          unite: product.unite_reference,
        },
      },
    },
  });

  console.log(`  → source=${sourceBatch.id}, child=${childBatch.id}, shipment=${shipment.id}`);
  return {
    sourceBatchId: sourceBatch.id,
    childBatchId: childBatch.id,
    shipmentId: shipment.id,
    customerId: customer.id,
    customerName: customer.nom_enseigne,
    shipmentRef: shipment.shipment_id,
    userId: member.userId,
    transformationId: transformation.id,
    locationId: location.id,
    equipmentId: equipment.id,
  };
}

async function cleanup(f: Fixtures) {
  console.log('\n[E2E] Cleanup...');
  // Ordre inverse des FK
  await prisma.liaison_Shipment.deleteMany({ where: { id_expedition: f.shipmentId } });
  await prisma.shipment.delete({ where: { id: f.shipmentId } });
  await prisma.transformationComposition.deleteMany({
    where: { id_transformation: f.transformationId },
  });
  await prisma.transformation.delete({ where: { id: f.transformationId } });
  await prisma.batch.deleteMany({ where: { id: { in: [f.sourceBatchId, f.childBatchId] } } });
  await prisma.customer.delete({ where: { id: f.customerId } });
  console.log('  → fixtures supprimées');
}

async function main() {
  console.log(`[E2E] Recall impact — org ${ORG_ID}`);

  let fixtures: Fixtures | null = null;
  try {
    fixtures = await setup();

    // === Scénario : déclencher le recall sur le LOT SOURCE ===
    console.log('\nScénario — recall sur lot source, attente du shipment du LOT ENFANT en sortie');

    const auditBefore = await prisma.audit_Log.count({
      where: { action: 'BATCH_RECALL_TRIGGERED', organization_id: ORG_ID! },
    });

    const recallStart = Date.now();
    const result = await recallService.triggerRecall(
      fixtures.sourceBatchId,
      ORG_ID!,
      fixtures.userId,
      'E2E test — Listeria simulation'
    );
    const recallMs = Date.now() - recallStart;

    // 0. Objectif SMART n°5 : décision → traitement < 15 min.
    // La métrique couvre le coeur transactionnel (blocage descendance + alerte + audit).
    // La notification email est fire-and-forget hors transaction, donc hors de cette mesure.
    console.log(`Rappel exécuté en ${recallMs} ms`);
    assert(recallMs < 15 * 60 * 1000, `rappel exécuté en < 15 min (mesuré ${recallMs} ms)`);

    // 1. Blocage propagé : source + child
    assert(result.blockedBatchesCount === 2, `blockedBatchesCount === 2 (reçu ${result.blockedBatchesCount})`);
    assert(
      result.impactedBatchIds.includes(fixtures.sourceBatchId) &&
        result.impactedBatchIds.includes(fixtures.childBatchId),
      'impactedBatchIds contient source ET enfant'
    );

    // 2. Affected shipments : 1 expédition trouvée (celle du lot enfant)
    assert(result.affectedShipments.length === 1, `affectedShipments.length === 1 (reçu ${result.affectedShipments.length})`);
    const shipment = result.affectedShipments[0];
    assert(shipment.shipmentId === fixtures.shipmentId, 'shipmentId correspond');
    assert(shipment.shipmentRef === fixtures.shipmentRef, `shipmentRef === ${fixtures.shipmentRef}`);
    assert(shipment.customerName === fixtures.customerName, `customerName === ${fixtures.customerName}`);
    assert(shipment.batchIds.includes(fixtures.childBatchId), 'batchIds contient le lot enfant');
    assert(shipment.batchIds.length === 1, 'batchIds.length === 1 (uniquement le child est dans ce shipment)');

    // 3. Statut DB : les 2 lots sont en ALERTE
    const blockedBatches = await prisma.batch.findMany({
      where: { id: { in: [fixtures.sourceBatchId, fixtures.childBatchId] } },
    });
    assert(blockedBatches.every((b) => b.statut === 'ALERTE'), 'Les 2 lots sont en ALERTE en DB');

    // 4. Audit WORM enrichi
    const auditAfter = await prisma.audit_Log.count({
      where: { action: 'BATCH_RECALL_TRIGGERED', organization_id: ORG_ID! },
    });
    assert(auditAfter === auditBefore + 1, `+1 ligne Audit_Log (avant=${auditBefore}, après=${auditAfter})`);

    const latestAudit = await prisma.audit_Log.findFirst({
      where: { action: 'BATCH_RECALL_TRIGGERED', organization_id: ORG_ID! },
      orderBy: { id: 'desc' },
    });
    const auditNewValue = latestAudit?.nouvelle_valeur as { affectedShipmentsCount?: number; shipmentRefs?: string[] };
    assert(auditNewValue?.affectedShipmentsCount === 1, 'audit newValue.affectedShipmentsCount === 1');
    assert(
      Array.isArray(auditNewValue?.shipmentRefs) && auditNewValue.shipmentRefs.includes(fixtures.shipmentRef),
      `audit newValue.shipmentRefs contient ${fixtures.shipmentRef}`
    );
  } catch (err) {
    console.error('\n[E2E] Erreur fatale:', err);
    failures.push(`Exception: ${(err as Error).message}`);
  } finally {
    if (fixtures) {
      try {
        await cleanup(fixtures);
      } catch (cleanupErr) {
        console.error('[E2E] Cleanup failed:', cleanupErr);
      }
    }
    await prisma.$disconnect();
    if (failures.length > 0) {
      console.error(`\n❌ ${failures.length} échec(s):`);
      failures.forEach((f) => console.error(`   - ${f}`));
      process.exitCode = 1;
    } else {
      console.log('\n✅ Tous les scénarios E2E recall-impact sont passés.');
    }
  }
}

main();
