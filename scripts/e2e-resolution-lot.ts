/**
 * E2E — résoudre un lot par le numéro lu sur son étiquette.
 *
 * Ce que ça prouve, sur la vraie chaîne Postgres + Prisma (les tests unitaires mockent Prisma :
 * ils ne prouvent NI le `mode: 'insensitive'`, NI le cloisonnement, qui sont du SQL) :
 *   1. Le lot scanné est retrouvé par son numéro.
 *   2. Il est retrouvé quelle que soit la CASSE du code saisi (sinon « lot inconnu » → l'opérateur
 *      réceptionne une deuxième fois une palette déjà en stock).
 *   3. Un numéro inconnu répond 404 (le client bascule alors sur une réception).
 *   4. ⚠️ Le lot d'une AUTRE organisation n'est JAMAIS résolu — scanner l'étiquette d'un
 *      concurrent n'ouvre pas la fiche de son lot (quantités, DLC, fournisseur).
 *   5. La fiche résolue porte les mêmes données que celle ouverte par id (même écran client).
 *
 * Lancement : npm run e2e:resolution-lot
 */
import { prisma } from '../src/shared/configs/prismaClient.config';
import { receiptService } from '../src/modules/logistics/receipts/services/receipt.service';
import { batchService } from '../src/modules/logistics/shared/services/batch.service';
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

async function status(action: Promise<unknown>): Promise<number | 'ok'> {
  try {
    await action;
    return 'ok';
  } catch (err) {
    return err instanceof APIError ? err.status : -1;
  }
}

const stamp = Date.now();
const batchIds: string[] = [];
const disposableOrgs: string[] = [];

async function cleanup() {
  await prisma.organization.deleteMany({ where: { id: { in: disposableOrgs } } });
  const receipts = await prisma.receipt.findMany({
    where: { organization_id: ORG_ID!, shipment_id: { startsWith: `E2E-RES-${stamp}` } },
    select: { id: true },
  });
  // `EPCIS_Event.related_id` n'est pas une FK : rien ne cascade, il faut le faire à la main.
  await prisma.ePCIS_Event.deleteMany({
    where: { organization_id: ORG_ID!, related_id: { in: receipts.map((r) => r.id) } },
  });
  await prisma.batch_Mouvement.deleteMany({ where: { id_lot: { in: batchIds } } });
  await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.receipt.deleteMany({ where: { id: { in: receipts.map((r) => r.id) } } });
}

async function main() {
  console.log('[E2E] Résoudre un lot par son numéro\n');
  const before = await prisma.batch.count({ where: { organization_id: ORG_ID } });

  try {
    const member = await prisma.member.findFirst({ where: { organizationId: ORG_ID! } });
    const product = await prisma.product.findFirst({ where: { organization_id: ORG_ID! } });
    const supplier = await prisma.supplier.findFirst({ where: { organization_id: ORG_ID! } });
    if (!member || !product || !supplier) {
      throw new Error('member / product / supplier seedé manquant pour cette org.');
    }

    // Le numéro vient de l'ÉTIQUETTE DU FOURNISSEUR, pas du serveur. Relire le numéro généré pour
    // le redonner au resolver serait un test qui se rassure tout seul : il passerait au vert même
    // si la réception jetait le numéro imprimé — c'est-à-dire même si la feature ne servait à rien.
    const lotNumber = `FRN-${stamp}`;

    const { batchId } = await receiptService.createReceipt({
      organization_id: ORG_ID!,
      id_fournisseur: supplier.id,
      shipment_id: `E2E-RES-${stamp}`,
      id_produit: product.id,
      quantite_actuelle: 42,
      unite_code: product.unite_reference,
      statut_controle: 'OK',
      received_by: member.userId,
      lot_number: lotNumber,
    });
    batchIds.push(batchId);
    console.log(`   (étiquette fournisseur scannée : ${lotNumber})\n`);

    console.log('1 — Le lot scanné est retrouvé par le numéro de son étiquette');
    const resolved = await batchService.resolveBatchByLotNumber(lotNumber, ORG_ID!);
    assert(resolved.id === batchId, `résolu sur le bon lot (${resolved.id})`);

    console.log('\n2 — Retrouvé quelle que soit la casse du code saisi');
    const lowercased = await batchService.resolveBatchByLotNumber(lotNumber.toLowerCase(), ORG_ID!);
    assert(lowercased.id === batchId, `« ${lotNumber.toLowerCase()} » résout le même lot`);

    console.log('\n3 — Un numéro inconnu répond 404 (le client bascule sur une réception)');
    const unknown = await status(batchService.resolveBatchByLotNumber('LOT-INEXISTANT', ORG_ID!));
    assert(unknown === 404, `numéro inconnu → ${unknown}`);

    console.log("\n4 — Le lot d'une AUTRE organisation n'est jamais résolu");
    // La base de démo n'a qu'une organisation : sans une seconde, le cloisonnement n'est pas
    // EXERCÉ, il est seulement supposé. On en crée donc une, jetable — un test qu'on saute est un
    // test qui ment.
    const otherOrg = await prisma.organization.create({
      data: {
        id: `e2e-org-${stamp}`,
        name: `E2E Concurrent ${stamp}`,
        slug: `e2e-concurrent-${stamp}`,
        createdAt: new Date(),
      },
    });
    disposableOrgs.push(otherOrg.id);

    const leak = await status(batchService.resolveBatchByLotNumber(lotNumber, otherOrg.id));
    assert(
      leak === 404,
      `le concurrent scanne « ${lotNumber} » et n'obtient rien → ${leak} (404 attendu)`
    );

    console.log('\n5 — La fiche résolue est celle qu’on ouvre par id (même écran client)');
    const byId = await batchService.getBatchById(batchId, ORG_ID!);
    assert(
      JSON.stringify(resolved) === JSON.stringify(byId),
      'résolution par numéro et ouverture par id renvoient la même fiche'
    );
  } catch (err) {
    console.error('\n[E2E] Erreur fatale:', err);
    failures.push('exception');
  } finally {
    console.log('\n[E2E] Cleanup...');
    // Un cleanup raté ne doit pas être avalé : il laisserait des déchets ET un ✅ final.
    await cleanup().catch((e) => {
      console.error('  cleanup:', e);
      failures.push('le nettoyage a échoué');
    });

    const after = await prisma.batch.count({ where: { organization_id: ORG_ID } });
    console.log(`[E2E] Lots en base : ${before} avant → ${after} après (doit être identique)`);
    if (after !== before) {
      failures.push(`fuite de données : ${after - before} lot(s) laissé(s) en base`);
    }

    // L'organisation jetable n'était comptée nulle part : elle pouvait survivre en silence.
    const ghostOrgs = await prisma.organization.count({ where: { id: { in: disposableOrgs } } });
    console.log(`[E2E] Organisations jetables restantes : ${ghostOrgs} (doit être 0)`);
    if (ghostOrgs > 0) {
      failures.push(`fuite de données : ${ghostOrgs} organisation(s) jetable(s) en base`);
    }
    await prisma.$disconnect();
  }

  if (failures.length > 0) {
    console.error(`\n❌ ${failures.length} échec(s):`);
    failures.forEach((x) => console.error(`   - ${x}`));
    process.exit(1);
  }
  console.log('\n✅ Un lot scanné se résout — et seulement dans son organisation.');
}

main();
