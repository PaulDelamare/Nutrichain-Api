/**
 * E2E — le lot remonte jusqu'à la ferme (lien Batch -> Receipt -> Supplier).
 *
 * Ce que ça prouve, sur la vraie chaîne Postgres + Prisma + transaction :
 *   1. Un lot reçu porte la clé étrangère `id_receipt` de sa réception (avant, aucun lien : la
 *      généalogie s'arrêtait au lot de lait cru).
 *   2. `getOrigins` d'un lot reçu DIRECTEMENT renvoie son fournisseur — le cas principal, celui que
 *      `getUpstream` seul (ancêtres uniquement) manquerait.
 *   3. Après transformation, `getOrigins` du lot ENFANT remonte encore jusqu'au même fournisseur :
 *      « du produit fini jusqu'à la ferme » du cahier des charges.
 *   4. Un produit fini pur (créé par transformation) n'a PAS d'`id_receipt` — le lien ne concerne
 *      que la matière première.
 *
 * Lancement : npm run e2e:batch-receipt
 */
import { prisma } from '../src/shared/configs/prismaClient.config';
import { receiptService } from '../src/modules/logistics/receipts/services/receipt.service';
import { transformationService } from '../src/modules/traceability/transformations/services/transformation.service';
import { genealogyService } from '../src/modules/traceability/transformations/services/genealogy.service';

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

const stamp = Date.now();
const batchIds: string[] = [];
const transformationIds: string[] = [];

async function cleanup() {
  await prisma.transformationComposition.deleteMany({
    where: { id_transformation: { in: transformationIds } },
  });
  await prisma.transformation.deleteMany({ where: { id: { in: transformationIds } } });

  const receipts = await prisma.receipt.findMany({
    where: { organization_id: ORG_ID!, shipment_id: { startsWith: `E2E-BR-${stamp}` } },
    select: { id: true },
  });
  await prisma.ePCIS_Event.deleteMany({
    where: { organization_id: ORG_ID!, related_id: { in: receipts.map((r) => r.id) } },
  });
  await prisma.batch_Mouvement.deleteMany({ where: { id_lot: { in: batchIds } } });
  await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.receipt.deleteMany({ where: { id: { in: receipts.map((r) => r.id) } } });
}

async function main() {
  console.log('[E2E] Le lot remonte jusqu’a la ferme\n');
  const before = await prisma.batch.count({ where: { organization_id: ORG_ID } });

  try {
    const member = await prisma.member.findFirst({ where: { organizationId: ORG_ID } });
    const product = await prisma.product.findFirst({
      where: { organization_id: ORG_ID, is_active: true },
    });
    const supplier = await prisma.supplier.findFirst({
      where: { organization_id: ORG_ID, is_active: true },
    });
    const equipment = await prisma.equipment.findFirst({ where: { organization_id: ORG_ID } });
    if (!member || !product || !supplier || !equipment) {
      throw new Error('member / product / supplier / equipment seedé manquant pour cette org.');
    }

    console.log('1 — Un lot reçu est rattaché (FK) à sa réception');
    const received = await receiptService.createReceipt({
      organization_id: ORG_ID,
      id_fournisseur: supplier.id,
      shipment_id: `E2E-BR-${stamp}-1`,
      id_produit: product.id,
      quantite_actuelle: 100,
      unite_code: product.unite_reference,
      statut_controle: 'OK',
      received_by: member.userId,
    });
    batchIds.push(received.batchId);
    const receivedBatch = await prisma.batch.findUniqueOrThrow({ where: { id: received.batchId } });
    assert(
      receivedBatch.id_receipt === received.receiptId,
      `le lot porte id_receipt (${receivedBatch.id_receipt})`
    );

    console.log('\n2 — getOrigins d’un lot reçu directement nomme la ferme');
    const receivedOrigins = await genealogyService.getOrigins(received.batchId, ORG_ID);
    assert(
      receivedOrigins.length === 1 && receivedOrigins[0].fournisseur.nom_ferme === supplier.nom_ferme,
      `origine = ${receivedOrigins[0]?.fournisseur.nom_ferme ?? '(vide)'} (attendu ${supplier.nom_ferme})`
    );

    console.log('\n3 — Après transformation, l’enfant remonte encore à la ferme');
    const transformation = await transformationService.createTransformation({
      organization_id: ORG_ID,
      id_produit_fini: product.id,
      id_materiel: equipment.id,
      quantite_produite: 30,
      unite_code: product.unite_reference,
      created_by: member.userId,
      inputs: [
        {
          id_lot_parent: received.batchId,
          quantite_prelevee: 20,
          unite: product.unite_reference,
          lot_parent_epuise: false,
        },
      ],
    });
    transformationIds.push(transformation.transformation_id);
    const childBatch = transformation.lot_enfant_id;
    batchIds.push(childBatch);

    const child = await prisma.batch.findUniqueOrThrow({ where: { id: childBatch } });
    assert(
      child.id_receipt === null,
      "le produit fini n'a PAS d'id_receipt (matière première seule)"
    );

    const childOrigins = await genealogyService.getOrigins(childBatch, ORG_ID);
    assert(
      childOrigins.some((o) => o.fournisseur.nom_ferme === supplier.nom_ferme),
      `l'enfant remonte à ${supplier.nom_ferme} (origines: ${
        childOrigins.map((o) => o.fournisseur.nom_ferme).join(', ') || '(vide)'
      })`
    );
  } catch (err) {
    console.error('\n[E2E] Erreur fatale:', err);
    failures.push('exception');
  } finally {
    console.log('\n[E2E] Cleanup...');
    await cleanup().catch((e) => console.error('  cleanup:', e));
    const after = await prisma.batch.count({ where: { organization_id: ORG_ID } });
    console.log(`[E2E] Lots en base : ${before} avant → ${after} après (doit être identique)`);
    if (after !== before) {
      failures.push(`fuite de données : ${after - before} lot(s) laissé(s) en base`);
    }
    await prisma.$disconnect();
  }

  if (failures.length > 0) {
    console.error(`\n❌ ${failures.length} échec(s):`);
    failures.forEach((x) => console.error(`   - ${x}`));
    process.exit(1);
  }
  console.log('\n✅ La généalogie remonte du produit fini jusqu’au fournisseur.');
}

main();
