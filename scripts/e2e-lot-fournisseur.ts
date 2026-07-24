/**
 * E2E — le lot du fournisseur et sa date de péremption.
 *
 * Ce que ça prouve, sur la vraie chaîne Postgres + Prisma + transaction :
 *   1. Le numéro de lot imprimé par le fournisseur est CELUI enregistré (le serveur n'en invente
 *      plus un) → une palette rescannée se retrouve, au lieu d'être réceptionnée deux fois.
 *   2. La DLC est stockée au JOUR EXACT, sans décalage de fuseau (le piège qui a déjà daté un
 *      rappel produit à +2 h : une date lue en heure locale recule d'un jour en UTC).
 *   3. Sans DLC imprimée, la durée de conservation du produit prend le relais → plus AUCUN lot ne
 *      naît sans date, donc la garde « lot périmé » cesse d'être du code mort.
 *   4. Recevoir DEUX FOIS le même numéro de lot est refusé (409) — et ne crée pas de second lot.
 *   5. Sans numéro imprimé, le serveur génère comme avant (aucune régression).
 *
 * Lancement : npm run e2e:lot-fournisseur
 */
import { prisma } from '../src/shared/configs/prismaClient.config';
import { receiptService } from '../src/modules/logistics/receipts/services/receipt.service';
import { APIError } from '../src/shared/utils/errorHandler/APIError';

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

interface Fixtures {
  supplierId: string;
  productId: string;
  uniteCode: string;
  userId: string;
  shelfLife: number;
}

async function setup(): Promise<Fixtures> {
  const member = await prisma.member.findFirst({ where: { organizationId: ORG_ID! } });
  const product = await prisma.product.findFirst({ where: { organization_id: ORG_ID! } });
  const supplier = await prisma.supplier.findFirst({ where: { organization_id: ORG_ID! } });
  if (!member || !product || !supplier) {
    throw new Error('member / product / supplier seedé manquant pour cette org.');
  }

  return {
    supplierId: supplier.id,
    productId: product.id,
    uniteCode: product.unite_reference,
    userId: member.userId,
    shelfLife: product.duree_conservation_defaut,
  };
}

async function receive(
  f: Fixtures,
  extra: { lot_number?: string; date_peremption?: string },
  seq: number
) {
  const res = await receiptService.createReceipt({
    organization_id: ORG_ID!,
    id_fournisseur: f.supplierId,
    shipment_id: `E2E-LOT-${stamp}-${seq}`,
    id_produit: f.productId,
    quantite_actuelle: 42,
    unite_code: f.uniteCode,
    statut_controle: 'OK',
    received_by: f.userId,
    ...extra,
  });
  batchIds.push(res.batchId);
  return res.batchId;
}

async function cleanup() {
  // `EPCIS_Event.related_id` n'est PAS une clé étrangère : rien ne cascade. Sans cette ligne, le
  // script laisse des événements de réception fantômes à chaque exécution — et l'export EPCIS les
  // émet, pointant vers des réceptions supprimées.
  const receipts = await prisma.receipt.findMany({
    where: { organization_id: ORG_ID!, shipment_id: { startsWith: `E2E-LOT-${stamp}` } },
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
  console.log('[E2E] Le lot du fournisseur et sa DLC\n');
  const before = await prisma.batch.count({ where: { organization_id: ORG_ID } });
  let f: Fixtures | undefined;

  try {
    f = await setup();

    console.log('1 — Le numéro de lot du fournisseur est celui enregistré');
    const supplierLot = `FRN-${stamp}`;
    const id1 = await receive(f, { lot_number: supplierLot, date_peremption: '2026-12-20' }, 1);
    const batch1 = await prisma.batch.findUniqueOrThrow({ where: { id: id1 } });
    assert(
      batch1.lot_number === supplierLot,
      `le lot porte le numéro imprimé (${batch1.lot_number})`
    );

    console.log('\n2 — La DLC laisse le lot vivre tout son dernier jour');
    assert(
      batch1.date_peremption?.toISOString() === '2026-12-20T23:59:59.999Z',
      `DLC stockée = ${batch1.date_peremption?.toISOString()} (attendu 2026-12-20T23:59:59.999Z)`
    );

    console.log("\n3 — Sans DLC imprimée, la durée de conservation du produit prend le relais");
    const id2 = await receive(f, { lot_number: `FRN-${stamp}-B` }, 2);
    const batch2 = await prisma.batch.findUniqueOrThrow({ where: { id: id2 } });
    const expected = new Date();
    expected.setUTCDate(expected.getUTCDate() + f.shelfLife);
    expected.setUTCHours(23, 59, 59, 999);
    assert(
      batch2.date_peremption !== null,
      'un lot reçu ne naît JAMAIS sans DLC (la garde « lot périmé » cesse d’être du code mort)'
    );
    assert(
      batch2.date_peremption?.toISOString() === expected.toISOString(),
      `DLC de repli = ${batch2.date_peremption?.toISOString()} (J+${f.shelfLife})`
    );

    console.log('\n4 — Recevoir deux fois le même numéro de lot est refusé, sans doublon');
    const beforeDuplicate = await prisma.batch.count({ where: { organization_id: ORG_ID } });
    let rejection: unknown;
    try {
      await receive(f, { lot_number: supplierLot }, 3);
    } catch (err) {
      rejection = err;
    }
    assert(
      rejection instanceof APIError && rejection.status === 409,
      `le second envoi est refusé en 409 (reçu : ${
        rejection instanceof APIError ? rejection.status : String(rejection)
      })`
    );
    const afterDuplicate = await prisma.batch.count({ where: { organization_id: ORG_ID } });
    assert(
      afterDuplicate === beforeDuplicate,
      `aucun lot en double n'a été créé (${beforeDuplicate} → ${afterDuplicate})`
    );

    console.log("\n5 — Sans numéro imprimé, le serveur génère comme avant");
    const id4 = await receive(f, {}, 4);
    const batch4 = await prisma.batch.findUniqueOrThrow({ where: { id: id4 } });
    assert(
      /^\d{6}-[0-9A-Z]+$/.test(batch4.lot_number),
      `numéro généré par le serveur (${batch4.lot_number})`
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
  console.log('\n✅ Le lot du fournisseur est conservé, et plus aucun lot ne naît sans DLC.');
}

main();
