/**
 * E2E — référentiel d'unités aligné sur une source unique (issue #75).
 *
 * Prouve contre PostgreSQL réel que :
 *  1. La table Unit contient exactement le référentiel canonique (units.constants).
 *  2. Aucun lot n'a d'unite_code orphelin (FK Batch.unite_code -> Unit.code).
 *  3. Une réception en `KG` réussit (cassait en 400 « Unité inconnue » avant : la table avait `kg`).
 *  4. Une réception en `kg` (minuscule) est normalisée en `KG`, pas rejetée.
 *  5. Une réception en `G` réussit (unité absente de la table avant).
 *  6. Une unité hors référentiel (`XYZ`) est refusée en 400.
 *
 * Pré-requis : Postgres + migrations + seed. Lancement : npm run e2e:units-referential
 */
import { prisma } from '../src/shared/configs/prismaClient.config';
import { receiptService } from '../src/modules/logistics/receipts/services/receipt.service';
import { VALID_UNITS } from '../src/shared/constants/units.constants';

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

async function receive(unitCode: string, suffix: string) {
  const supplier = await prisma.supplier.findFirstOrThrow({ where: { organization_id: ORG_ID! } });
  const product = await prisma.product.findFirstOrThrow({ where: { organization_id: ORG_ID! } });
  const member = await prisma.member.findFirstOrThrow({
    where: { organizationId: ORG_ID!, role: { in: ['owner', 'admin'] } },
  });
  const received = await receiptService.createReceipt({
    organization_id: ORG_ID!,
    id_fournisseur: supplier.id,
    shipment_id: `E2E-UNITS-${Date.now()}-${suffix}`,
    id_produit: product.id,
    quantite_actuelle: 10,
    unite_code: unitCode,
    statut_controle: 'OK',
    received_by: member.userId,
  });
  return prisma.batch.findUniqueOrThrow({ where: { id: received.batchId } });
}

async function main() {
  const created: string[] = [];

  console.log('\n[E2E] 1 — la table Unit = référentiel canonique');
  const units = (await prisma.unit.findMany({ select: { code: true } })).map((u) => u.code).sort();
  const expected = [...VALID_UNITS].sort();
  assert(
    JSON.stringify(units) === JSON.stringify(expected),
    `Unit = [${units.join(', ')}] (attendu [${expected.join(', ')}])`
  );

  console.log('\n[E2E] 2 — aucun lot orphelin (FK intacte)');
  const orphans = await prisma.$queryRaw<{ unite_code: string }[]>`
    SELECT DISTINCT b.unite_code FROM "Batch" b
    LEFT JOIN "Unit" u ON b.unite_code = u.code WHERE u.code IS NULL`;
  assert(orphans.length === 0, `lots orphelins : ${JSON.stringify(orphans)}`);

  console.log('\n[E2E] 3-5 — réceptions dans des unités qui cassaient avant');
  const batchKG = await receive('KG', 'KG');
  created.push(batchKG.id);
  assert(batchKG.unite_code === 'KG', 'réception en KG → lot en KG');

  const batchMin = await receive('kg', 'min');
  created.push(batchMin.id);
  assert(batchMin.unite_code === 'KG', 'réception en `kg` → normalisée en KG (tolérance casse)');

  const batchG = await receive('G', 'G');
  created.push(batchG.id);
  assert(batchG.unite_code === 'G', 'réception en G → lot en G');

  console.log('\n[E2E] 6 — une unité hors référentiel est refusée');
  let refuse = false;
  try {
    const batch = await receive('XYZ', 'bad');
    created.push(batch.id);
  } catch (e) {
    refuse = (e as { status?: number }).status === 400;
  }
  assert(refuse, 'réception en `XYZ` → refusée en 400');

  // Cleanup
  await prisma.batch_Mouvement.deleteMany({ where: { id_lot: { in: created } } });
  await prisma.batch.deleteMany({ where: { id: { in: created } } });
  await prisma.receipt.deleteMany({
    where: { organization_id: ORG_ID!, shipment_id: { startsWith: 'E2E-UNITS-' } },
  });
  await prisma.$disconnect();

  if (failures.length > 0) {
    console.error(`\n[E2E] ❌ ${failures.length} assertion(s) en échec.`);
    process.exit(1);
  }
  console.log('\n[E2E] ✅ Tous les scénarios passent.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
