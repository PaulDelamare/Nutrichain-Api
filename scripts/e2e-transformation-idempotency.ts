/**
 * E2E — idempotence de la transformation (issue #76), contre PostgreSQL réel.
 *
 * Prouve : deux appels avec le MÊME client_op_id ne créent qu'UNE transformation et ne prélèvent
 * les lots parents qu'UNE fois (le 2e est un replay). Un client_op_id différent, lui, re-prélève.
 *
 * Pré-requis : Postgres + migrations + seed. Lancement : npm run e2e:transformation-idempotency
 */
import { prisma } from '../src/shared/configs/prismaClient.config';
import { transformationService } from '../src/modules/traceability/transformations/services/transformation.service';
import crypto from 'crypto';

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

async function main() {
  const stamp = Date.now();
  const member = await prisma.member.findFirstOrThrow({ where: { organizationId: ORG_ID! } });
  const product = await prisma.product.findFirstOrThrow({ where: { organization_id: ORG_ID! } });
  const unit = await prisma.unit.findFirstOrThrow();
  const location = await prisma.location.findFirstOrThrow({ where: { organization_id: ORG_ID! } });
  const cuve = await prisma.equipment.create({
    data: {
      organization_id: ORG_ID!, nom: `E2E-IDEM-CUVE-${stamp}`, type: 'CUVE',
      id_lieu: location.id, qr_code_id: `E2E-IDEM-QR-${stamp}`,
    },
  });
  const parent = await prisma.batch.create({
    data: {
      organization_id: ORG_ID!, id_produit: product.id, lot_number: `E2E-IDEM-P-${stamp}`,
      quantite_actuelle: 1000, quantite_base: 1000, unite_code: unit.code, statut: 'EN_STOCK',
      created_by: member.userId,
    },
  });

  const clientOpId = crypto.randomUUID();
  const call = (opId?: string) =>
    transformationService.createTransformation({
      organization_id: ORG_ID!,
      id_produit_fini: product.id,
      id_materiel: cuve.id,
      quantite_produite: 10,
      unite_code: unit.code,
      created_by: member.userId,
      client_op_id: opId,
      inputs: [
        { id_lot_parent: parent.id, quantite_prelevee: 100, unite: unit.code, lot_parent_epuise: false },
      ],
    });

  console.log('\n[E2E] 1 — deux appels avec le MÊME client_op_id');
  const r1 = await call(clientOpId);
  const stockApres1 = (await prisma.batch.findUniqueOrThrow({ where: { id: parent.id } }))
    .quantite_actuelle;
  const r2 = await call(clientOpId);
  const stockApres2 = (await prisma.batch.findUniqueOrThrow({ where: { id: parent.id } }))
    .quantite_actuelle;

  assert(
    r1.transformation_id === r2.transformation_id,
    'le 2e appel renvoie la MÊME transformation (replay)'
  );
  assert(
    Number(stockApres1) === Number(stockApres2),
    `le stock parent n'est prélevé qu'une fois (${stockApres1} → inchangé après replay)`
  );
  const nbTransfos = await prisma.transformation.count({
    where: { id_lot_enfant: r1.lot_enfant_id },
  });
  assert(nbTransfos === 1, 'une seule transformation en base');

  console.log('\n[E2E] 2 — un client_op_id DIFFÉRENT re-prélève (opération distincte)');
  const r3 = await call(crypto.randomUUID());
  assert(r3.transformation_id !== r1.transformation_id, 'nouvelle transformation créée');
  const stockApres3 = (await prisma.batch.findUniqueOrThrow({ where: { id: parent.id } }))
    .quantite_actuelle;
  assert(Number(stockApres3) < Number(stockApres2), 'le stock parent a de nouveau baissé');

  // Cleanup
  const enfants = [r1.lot_enfant_id, r3.lot_enfant_id];
  await prisma.idempotencyKey.deleteMany({ where: { organization_id: ORG_ID!, client_op_id: clientOpId } });
  await prisma.ePCIS_Event.deleteMany({ where: { related_id: { in: [r1.transformation_id, r3.transformation_id] } } });
  await prisma.batch_Mouvement.deleteMany({ where: { id_lot: { in: [parent.id, ...enfants] } } });
  await prisma.transformationComposition.deleteMany({ where: { id_lot_parent: parent.id } });
  await prisma.transformation.deleteMany({ where: { id_lot_enfant: { in: enfants } } });
  await prisma.batch.deleteMany({ where: { id: { in: [parent.id, ...enfants] } } });
  await prisma.equipment.delete({ where: { id: cuve.id } });
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
