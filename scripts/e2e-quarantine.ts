/**
 * E2E — quarantaine sanitaire d'un lot reçu non-conforme (HACCP).
 *
 * Valide la vraie chaîne Postgres + Prisma + transactions + audit WORM sur le
 * parcours complet de sûreté :
 *   1. Réception avec contrôle NONCONFORME -> le lot est créé en BLOQUE (quarantaine).
 *   2. Toute transformation du lot bloqué est refusée.
 *   3. Toute expédition du lot bloqué est refusée.
 *   4. La levée de quarantaine (décision qualité) repasse le lot en EN_STOCK + audit WORM.
 *   5. Après levée, le lot est de nouveau expédiable (preuve du déblocage).
 *
 * Pré-requis :
 * - DB Postgres up + migrations + seed (`npx prisma db seed`)
 * - .env contient API_KEY_ORG_ID="usine-laitiere-paris"
 *
 * Lancement : npm run e2e:quarantine
 */
import { prisma } from '../src/shared/configs/prismaClient.config';
import { receiptService } from '../src/modules/logistics/receipts/services/receipt.service';
import { batchService } from '../src/modules/logistics/shared/services/batch.service';
import { transformationService } from '../src/modules/traceability/transformations/services/transformation.service';
import { shipmentService } from '../src/modules/logistics/shipments/services/shipment.service';

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

/** Exécute une promesse censée être rejetée ; renvoie true si elle l'a bien été. */
async function expectRejected(action: Promise<unknown>, status?: number): Promise<boolean> {
  try {
    await action;
    return false;
  } catch (e) {
    // Sans vérifier le code, un refus pour une TOUT AUTRE raison passerait pour le refus attendu.
    if (status === undefined) return true;
    return (e as { status?: number }).status === status;
  }
}

interface Fixtures {
  supplierId: string;
  customerId: string;
  productId: string;
  uniteCode: string;
  equipmentId: string;
  userId: string;
  /** Décideur qualité, DISTINCT de `userId` : on ne libère pas le lot qu'on a soi-même enregistré. */
  qualityUserId: string;
  createdBatchIds: string[];
}

async function setup(): Promise<Fixtures> {
  console.log('\n[E2E] Setup des fixtures...');
  const member = await prisma.member.findFirst({ where: { organizationId: ORG_ID! } });
  const product = await prisma.product.findFirst({ where: { organization_id: ORG_ID! } });
  const supplier = await prisma.supplier.findFirst({ where: { organization_id: ORG_ID! } });
  if (!member || !product || !supplier) {
    throw new Error('member / product / supplier seedé manquant pour cette org.');
  }

  // La séparation des tâches HACCP interdit de libérer un lot qu'on a soi-même enregistré :
  // le scénario a donc besoin d'un SECOND acteur habilité pour jouer la décision qualité.
  const qualityMember = await prisma.member.findFirst({
    where: {
      organizationId: ORG_ID!,
      userId: { not: member.userId },
      role: { in: ['owner', 'admin', 'quality'] },
    },
  });
  if (!qualityMember) {
    throw new Error(
      'Aucun second membre habilité (owner/admin/quality) : la levée de quarantaine ne peut pas ' +
        'être jouée. Lance `npx prisma db seed` pour créer les comptes par rôle.'
    );
  }

  const stamp = Date.now();
  const customer = await prisma.customer.create({
    data: {
      organization_id: ORG_ID!,
      nom_enseigne: `E2E-Quarantine-Customer-${stamp}`,
      contact_urgence: '+33000000000',
      adresse_livraison: 'E2E quarantine address',
    },
  });

  let location = await prisma.location.findFirst({ where: { organization_id: ORG_ID! } });
  if (!location) {
    location = await prisma.location.create({
      data: { organization_id: ORG_ID!, nom: `E2E-Loc-${stamp}`, type: 'WAREHOUSE' },
    });
  }
  let equipment = await prisma.equipment.findFirst({ where: { organization_id: ORG_ID! } });
  if (!equipment) {
    equipment = await prisma.equipment.create({
      data: { organization_id: ORG_ID!, nom: `E2E-Eq-${stamp}`, type: 'MIXER', id_lieu: location.id },
    });
  }

  return {
    supplierId: supplier.id,
    customerId: customer.id,
    productId: product.id,
    uniteCode: product.unite_reference,
    equipmentId: equipment.id,
    userId: member.userId,
    qualityUserId: qualityMember.userId,
    createdBatchIds: [],
  };
}

async function cleanup(f: Fixtures) {
  console.log('\n[E2E] Cleanup...');
  // Liaisons / mouvements / shipments référencant nos lots
  await prisma.liaison_Shipment.deleteMany({ where: { id_lot: { in: f.createdBatchIds } } });
  await prisma.batch_Mouvement.deleteMany({ where: { id_lot: { in: f.createdBatchIds } } });
  await prisma.shipment.deleteMany({
    where: { organization_id: ORG_ID!, id_client: f.customerId },
  });
  await prisma.ePCIS_Event.deleteMany({
    where: { organization_id: ORG_ID!, related_id: { in: f.createdBatchIds } },
  });
  // Les mouvements référencent le lot (FK) : les purger d'abord.
  await prisma.batch_Mouvement.deleteMany({ where: { id_lot: { in: f.createdBatchIds } } });
  // ⚠️ Les LOTS avant les RÉCEPTIONS : `Batch.id_receipt` est en `onDelete: Restrict`, donc
  // supprimer la réception d'abord viole la contrainte, avorte tout le nettoyage, et laisse
  // lots, réceptions et client en base à chaque exécution.
  await prisma.batch.deleteMany({ where: { id: { in: f.createdBatchIds } } });
  await prisma.receipt.deleteMany({ where: { organization_id: ORG_ID!, id_fournisseur: f.supplierId, shipment_id: { startsWith: 'E2E-QUAR-' } } });
  await prisma.customer.delete({ where: { id: f.customerId } });
  console.log('  → fixtures supprimées');
}

async function main() {
  console.log(`[E2E] Quarantaine non-conforme — org ${ORG_ID}`);
  let fixtures: Fixtures | null = null;
  try {
    fixtures = await setup();

    // === 1. Réception NONCONFORME -> lot BLOQUE ===
    console.log('\nScénario 1 — réception NONCONFORME crée un lot en quarantaine');
    const stamp = Date.now();
    const received = await receiptService.createReceipt({
      organization_id: ORG_ID!,
      id_fournisseur: fixtures.supplierId,
      id_produit: fixtures.productId,
      shipment_id: `E2E-QUAR-${stamp}`,
      statut_controle: 'NONCONFORME',
      received_by: fixtures.userId,
      quantite_actuelle: 100,
      unite_code: fixtures.uniteCode,
    });
    fixtures.createdBatchIds.push(received.batchId);

    const blockedBatch = await prisma.batch.findUnique({ where: { id: received.batchId } });
    assert(blockedBatch?.statut === 'BLOQUE', `lot reçu NONCONFORME est en BLOQUE (reçu ${blockedBatch?.statut})`);

    // === 2. Transformation refusée ===
    console.log('\nScénario 2 — transformation d un lot bloqué refusée');
    const transfoRejected = await expectRejected(
      transformationService.createTransformation({
        organization_id: ORG_ID!,
        id_produit_fini: fixtures.productId,
        id_materiel: fixtures.equipmentId,
        quantite_produite: 10,
        unite_code: fixtures.uniteCode,
        created_by: fixtures.userId,
        inputs: [
          { id_lot_parent: received.batchId, quantite_prelevee: 10, unite: fixtures.uniteCode, lot_parent_epuise: false },
        ],
      })
    );
    assert(transfoRejected, 'transformation du lot BLOQUE refusée');

    // === 3. Expédition refusée ===
    console.log('\nScénario 3 — expédition d un lot bloqué refusée');
    const shipRejected = await expectRejected(
      shipmentService.createShipment({
        organization_id: ORG_ID!,
        id_client: fixtures.customerId,
        shipment_id: 'AUTO',
        transporteur: 'E2E Transporteur',
        date_envoi: new Date(),
        created_by: fixtures.userId,
        items: [{ id_lot: received.batchId, quantite: 10 }],
      })
    );
    assert(shipRejected, 'expédition du lot BLOQUE refusée');

    // === 4. Levée de quarantaine -> EN_STOCK + audit WORM ===
    console.log('\nScénario 4 — levée de quarantaine (décision qualité tracée)');
    const auditBefore = await prisma.audit_Log.count({
      where: { action: 'LIFT_BATCH_QUARANTINE', organization_id: ORG_ID! },
    });
    // Levée par un TIERS habilité : celui qui a réceptionné ne signe pas la libération.
    const selfLiftRejected = await expectRejected(
      batchService.liftQuarantine(
        received.batchId,
        ORG_ID!,
        fixtures.userId,
        'E2E — levée par celui qui a réceptionné'
      ),
      403
    );
    assert(selfLiftRejected, 'levée par l auteur de la réception refusée (403, séparation des tâches)');

    const lifted = await batchService.liftQuarantine(
      received.batchId,
      ORG_ID!,
      fixtures.qualityUserId,
      'E2E — second contrôle qualité conforme'
    );
    assert(lifted.statut === 'EN_STOCK', `lot repassé en EN_STOCK après levée (reçu ${lifted.statut})`);

    const auditAfter = await prisma.audit_Log.count({
      where: { action: 'LIFT_BATCH_QUARANTINE', organization_id: ORG_ID! },
    });
    assert(auditAfter === auditBefore + 1, `+1 ligne Audit_Log LIFT_BATCH_QUARANTINE (avant=${auditBefore}, après=${auditAfter})`);

    // Levée d'un lot non bloqué -> refus 409
    const reLiftRejected = await expectRejected(
      batchService.liftQuarantine(received.batchId, ORG_ID!, fixtures.qualityUserId, 'double levée'),
      409
    );
    assert(reLiftRejected, 'seconde levée (lot déjà EN_STOCK) refusée (409)');

    // === 5. Après levée, l expédition passe ===
    console.log('\nScénario 5 — après levée, le lot est de nouveau expédiable');
    const shipment = await shipmentService.createShipment({
      organization_id: ORG_ID!,
      id_client: fixtures.customerId,
      shipment_id: 'AUTO',
      transporteur: 'E2E Transporteur',
      date_envoi: new Date(),
      created_by: fixtures.userId,
      items: [{ id_lot: received.batchId, quantite: 10 }],
    });
    assert(!!shipment, 'expédition acceptée après levée de quarantaine');
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
      console.log('\n✅ Tous les scénarios E2E quarantaine sont passés.');
    }
  }
}

main();
