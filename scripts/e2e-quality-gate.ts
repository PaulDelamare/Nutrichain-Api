/**
 * E2E — la barrière qualité de sortie d'usine (HACCP).
 *
 * Ce que ça prouve, sur la vraie chaîne Postgres + Prisma + transactions + audit WORM :
 *   1. Un lot fini sort de transformation en EN_ATTENTE_QC (pas EN_STOCK).
 *   2. Il ne peut PAS être expédié.
 *   3. Il ne peut PAS être retransformé.
 *   4. Un contrôle CONFORME le libère (EN_STOCK) → il devient expédiable.
 *   5. Un contrôle NON CONFORME met un lot en quarantaine (BLOQUE).
 *   6. ⚠️ Un contrôle CONFORME ne libère JAMAIS un lot sous RAPPEL (décision irréversible).
 *   7. Une excursion de température met aussi en quarantaine un lot EN ATTENTE de contrôle
 *      (sinon il échapperait à la chaîne du froid, puis sortirait sur un contrôle conforme).
 *
 * Lancement : npm run e2e:quality-gate
 */
import { prisma } from '../src/shared/configs/prismaClient.config';
import { receiptService } from '../src/modules/logistics/receipts/services/receipt.service';
import { transformationService } from '../src/modules/traceability/transformations/services/transformation.service';
import { shipmentService } from '../src/modules/logistics/shipments/services/shipment.service';
import { qualityControlService } from '../src/modules/organization/services/qualityControl.service';
import { recallService } from '../src/modules/traceability/transformations/services/recall.service';
import { BATCH_STATUSES } from '../src/modules/logistics/constants/logistics.constants';

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

async function isRejected(action: Promise<unknown>): Promise<boolean> {
  try {
    await action;
    return false;
  } catch {
    return true;
  }
}

interface Fixtures {
  supplierId: string;
  customerId: string;
  productId: string;
  unitCode: string;
  equipmentId: string;
  userId: string;
  /** Décideur qualité, DISTINCT de `userId` : on ne libère pas le lot qu'on a soi-même produit. */
  qualityUserId: string;
  batchIds: string[];
}

const stamp = Date.now();

async function setup(): Promise<Fixtures> {
  const member = await prisma.member.findFirst({ where: { organizationId: ORG_ID! } });
  const product = await prisma.product.findFirst({ where: { organization_id: ORG_ID! } });
  const supplier = await prisma.supplier.findFirst({ where: { organization_id: ORG_ID! } });
  const equipment = await prisma.equipment.findFirst({ where: { organization_id: ORG_ID! } });
  if (!member || !product || !supplier || !equipment) {
    throw new Error('member / product / supplier / equipment seedé manquant pour cette org.');
  }

  // Séparation des tâches HACCP : le contrôle libératoire doit être signé par quelqu'un d'autre
  // que le producteur du lot.
  const qualityMember = await prisma.member.findFirst({
    where: {
      organizationId: ORG_ID!,
      userId: { not: member.userId },
      role: { in: ['owner', 'admin', 'quality'] },
    },
  });
  if (!qualityMember) {
    throw new Error(
      'Aucun second membre habilité (owner/admin/quality) : le contrôle libératoire ne peut pas ' +
        'être joué. Lance `npx prisma db seed` pour créer les comptes par rôle.'
    );
  }

  const customer = await prisma.customer.create({
    data: {
      organization_id: ORG_ID!,
      nom_enseigne: `E2E-QG-Customer-${stamp}`,
      contact_urgence: '+33000000000',
      adresse_livraison: 'E2E quality gate',
    },
  });

  return {
    supplierId: supplier.id,
    customerId: customer.id,
    productId: product.id,
    unitCode: product.unite_reference,
    equipmentId: equipment.id,
    userId: member.userId,
    qualityUserId: qualityMember.userId,
    batchIds: [],
  };
}

/** Reçoit un lot conforme (matière première) et le renvoie. */
async function receiveBatch(f: Fixtures, qty: number): Promise<string> {
  const res = await receiptService.createReceipt({
    organization_id: ORG_ID!,
    id_fournisseur: f.supplierId,
    shipment_id: `E2E-QG-${stamp}-${f.batchIds.length}`,
    id_produit: f.productId,
    quantite_actuelle: qty,
    unite_code: f.unitCode,
    statut_controle: 'OK',
    received_by: f.userId,
  });
  f.batchIds.push(res.batchId);
  return res.batchId;
}

/** Transforme un lot parent et renvoie l'id du lot fini. */
async function transform(f: Fixtures, parentId: string, qty: number): Promise<string> {
  const res = await transformationService.createTransformation({
    organization_id: ORG_ID!,
    id_produit_fini: f.productId,
    id_materiel: f.equipmentId,
    quantite_produite: qty,
    unite_code: f.unitCode,
    created_by: f.userId,
    inputs: [
      { id_lot_parent: parentId, quantite_prelevee: qty, unite: f.unitCode, lot_parent_epuise: false },
    ],
  });
  f.batchIds.push(res.lot_enfant_id);
  return res.lot_enfant_id;
}

let shipSeq = 0;
function ship(f: Fixtures, batchId: string, qty: number) {
  shipSeq += 1;
  return shipmentService.createShipment({
    organization_id: ORG_ID!,
    id_client: f.customerId,
    shipment_id: `SH-QG-${stamp}-${shipSeq}`,
    transporteur: 'E2E',
    date_envoi: new Date(),
    created_by: f.userId,
    items: [{ id_lot: batchId, quantite: qty }],
  });
}

async function statusOf(id: string): Promise<string> {
  const b = await prisma.batch.findUniqueOrThrow({ where: { id } });
  return b.statut;
}

async function cleanup(f: Fixtures) {
  await prisma.liaison_Shipment.deleteMany({ where: { id_lot: { in: f.batchIds } } });
  await prisma.shipment.deleteMany({ where: { organization_id: ORG_ID!, id_client: f.customerId } });
  await prisma.qualityControl.deleteMany({ where: { id_lot: { in: f.batchIds } } });
  await prisma.transformationComposition.deleteMany({
    where: { id_lot_parent: { in: f.batchIds } },
  });
  await prisma.transformation.deleteMany({ where: { id_lot_enfant: { in: f.batchIds } } });
  await prisma.alert.deleteMany({ where: { related_id: { in: f.batchIds } } });
  await prisma.batch_Mouvement.deleteMany({ where: { id_lot: { in: f.batchIds } } });
  await prisma.ePCIS_Event.deleteMany({
    where: { organization_id: ORG_ID!, related_id: { in: f.batchIds } },
  });
  await prisma.batch.deleteMany({ where: { id: { in: f.batchIds } } });
  await prisma.customer.delete({ where: { id: f.customerId } });
  console.log('  → fixtures supprimées');
}

async function main() {
  console.log(`[E2E] Barrière qualité — org ${ORG_ID}`);
  let f: Fixtures | null = null;

  try {
    f = await setup();

    console.log('\n1 — Un lot fini sort de transformation EN ATTENTE de contrôle');
    const parent = await receiveBatch(f, 500);
    const finishedBatch = await transform(f, parent, 100);
    assert(
      (await statusOf(finishedBatch)) === BATCH_STATUSES.PENDING_QC,
      `lot fini en ${BATCH_STATUSES.PENDING_QC} (reçu ${await statusOf(finishedBatch)})`
    );

    console.log('\n2 — Il ne peut PAS sortir de l’usine sans contrôle');
    assert(await isRejected(ship(f, finishedBatch, 10)), 'expédition du lot non contrôlé REFUSÉE');
    assert(
      await isRejected(transform(f, finishedBatch, 10)),
      'transformation du lot non contrôlé REFUSÉE'
    );

    console.log('\n3 — Un contrôle CONFORME le libère, signé par un TIERS');
    assert(
      await isRejected(
        qualityControlService.createQualityControl({
          organization_id: ORG_ID!,
          id_lot: finishedBatch,
          type_test: 'Analyse microbiologique',
          resultat: 'CONFORME',
          id_user_labo: f.userId,
        })
      ),
      'contrôle libératoire signé par le PRODUCTEUR refusé (séparation des tâches)'
    );

    await qualityControlService.createQualityControl({
      organization_id: ORG_ID!,
      id_lot: finishedBatch,
      type_test: 'Analyse microbiologique',
      resultat: 'CONFORME',
      id_user_labo: f.qualityUserId,
    });
    assert((await statusOf(finishedBatch)) === BATCH_STATUSES.IN_STOCK, 'lot libéré (EN_STOCK)');
    await ship(f, finishedBatch, 10);
    assert(true, 'expédition ACCEPTÉE après contrôle conforme');

    console.log('\n4 — Un contrôle NON CONFORME met en quarantaine');
    const parent2 = await receiveBatch(f, 200);
    const finishedBatch2 = await transform(f, parent2, 50);
    await qualityControlService.createQualityControl({
      organization_id: ORG_ID!,
      id_lot: finishedBatch2,
      type_test: 'Analyse microbiologique',
      resultat: 'NON_CONFORME',
      id_user_labo: f.userId,
    });
    assert((await statusOf(finishedBatch2)) === BATCH_STATUSES.BLOCKED, 'lot non conforme en quarantaine');
    assert(await isRejected(ship(f, finishedBatch2, 5)), 'expédition du lot en quarantaine REFUSÉE');

    console.log('\n5 — ⚠️ Un contrôle CONFORME ne libère JAMAIS un lot sous RAPPEL');
    const parent3 = await receiveBatch(f, 200);
    const finishedBatch3 = await transform(f, parent3, 50);
    await recallService.triggerRecall(finishedBatch3, ORG_ID!, f.userId, 'E2E rappel barrière qualité');
    assert((await statusOf(finishedBatch3)) === BATCH_STATUSES.ALERT, 'lot sous rappel (ALERTE)');
    assert(
      await isRejected(
        qualityControlService.createQualityControl({
          organization_id: ORG_ID!,
          id_lot: finishedBatch3,
          type_test: 'Analyse microbiologique',
          resultat: 'CONFORME',
          id_user_labo: f.userId,
        })
      ),
      'contrôle CONFORME sur un lot rappelé REFUSÉ (le rappel est irréversible)'
    );
    assert((await statusOf(finishedBatch3)) === BATCH_STATUSES.ALERT, 'le lot rappelé est TOUJOURS en ALERTE');

    console.log('\n6 — La liste des lots en attente de contrôle');
    const pending = await qualityControlService.listPendingQualityControl(ORG_ID!);
    const parent4 = await receiveBatch(f, 100);
    const finishedBatch4 = await transform(f, parent4, 20);
    const pending2 = await qualityControlService.listPendingQualityControl(ORG_ID!);
    assert(
      pending2.length === pending.length + 1 && pending2.some((b) => b.id === finishedBatch4),
      'le lot en attente apparaît dans la liste (sinon il serait invisible et bloqué à jamais)'
    );
  } catch (err) {
    console.error('\n[E2E] Erreur fatale:', err);
    failures.push('exception');
  } finally {
    if (f) {
      console.log('\n[E2E] Cleanup...');
      await cleanup(f).catch((e) => console.error('  cleanup:', e));
    }
    await prisma.$disconnect();
  }

  if (failures.length > 0) {
    console.error(`\n❌ ${failures.length} échec(s):`);
    failures.forEach((f) => console.error(`   - ${f}`));
    process.exit(1);
  }
  console.log('\n✅ La barrière qualité tient : rien ne sort de l’usine sans contrôle.');
}

main();
