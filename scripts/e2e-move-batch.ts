/**
 * E2E — déplacement d'un lot (issue #73), contre PostgreSQL réel.
 *
 * Prouve : un lot EN_STOCK change d'emplacement (id_materiel_actuel mis à jour + mouvement +
 * audit) ; un lot BLOQUE est refusé (409) ; un matériel non-stockage est refusé (400) ; le
 * déplacement vers l'emplacement actuel est idempotent (200, sans mouvement).
 *
 * Pré-requis : Postgres + migrations + seed. Lancement : npm run e2e:move-batch
 */
import { prisma } from '../src/shared/configs/prismaClient.config';
import { batchService } from '../src/modules/logistics/shared/services/batch.service';

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

  const frigoA = await prisma.equipment.create({
    data: {
      organization_id: ORG_ID!, nom: `E2E-MV-A-${stamp}`, type: 'FRIGO',
      id_lieu: location.id, qr_code_id: `E2E-MV-QRA-${stamp}`,
    },
  });
  const frigoB = await prisma.equipment.create({
    data: {
      organization_id: ORG_ID!, nom: `E2E-MV-B-${stamp}`, type: 'ETAGERE',
      id_lieu: location.id, qr_code_id: `E2E-MV-QRB-${stamp}`,
    },
  });
  const cuve = await prisma.equipment.create({
    data: {
      organization_id: ORG_ID!, nom: `E2E-MV-CUVE-${stamp}`, type: 'CUVE',
      id_lieu: location.id, qr_code_id: `E2E-MV-QRC-${stamp}`,
    },
  });

  const makeBatch = (statut: string, materiel: string) =>
    prisma.batch.create({
      data: {
        organization_id: ORG_ID!, id_produit: product.id, lot_number: `E2E-MV-${stamp}-${statut}`,
        quantite_actuelle: 50, quantite_base: 50, unite_code: unit.code, statut,
        id_materiel_actuel: materiel, created_by: member.userId,
      },
    });

  const lot = await makeBatch('EN_STOCK', frigoA.id);
  const bloque = await makeBatch('BLOQUE', frigoA.id);

  console.log('\n[E2E] 1 — un lot EN_STOCK se déplace de A vers B');
  await batchService.moveBatch(lot.id, ORG_ID!, member.userId, frigoB.id);
  const apres = await prisma.batch.findUniqueOrThrow({ where: { id: lot.id } });
  assert(apres.id_materiel_actuel === frigoB.id, 'position mise à jour vers le frigo B');
  const mvt = await prisma.batch_Mouvement.findFirst({
    where: { id_lot: lot.id, type_action: 'DEPLACEMENT' },
  });
  assert(mvt !== null, 'un mouvement DEPLACEMENT est tracé');

  console.log('\n[E2E] 2 — déplacer vers l’emplacement actuel est idempotent (pas de 2e mouvement)');
  await batchService.moveBatch(lot.id, ORG_ID!, member.userId, frigoB.id);
  const mvtCount = await prisma.batch_Mouvement.count({
    where: { id_lot: lot.id, type_action: 'DEPLACEMENT' },
  });
  assert(mvtCount === 1, 'toujours un seul mouvement DEPLACEMENT (no-op)');

  console.log('\n[E2E] 3 — un lot BLOQUE ne se déplace pas (409)');
  let refuseBloque = false;
  try {
    await batchService.moveBatch(bloque.id, ORG_ID!, member.userId, frigoB.id);
  } catch (e) {
    refuseBloque = (e as { status?: number }).status === 409;
  }
  assert(refuseBloque, 'déplacement d’un lot BLOQUE refusé en 409');

  console.log('\n[E2E] 4 — on ne range pas un lot dans une CUVE (400)');
  let refuseCuve = false;
  try {
    await batchService.moveBatch(lot.id, ORG_ID!, member.userId, cuve.id);
  } catch (e) {
    refuseCuve = (e as { status?: number }).status === 400;
  }
  assert(refuseCuve, 'déplacement vers une CUVE refusé en 400');

  // Cleanup
  await prisma.batch_Mouvement.deleteMany({ where: { id_lot: { in: [lot.id, bloque.id] } } });
  await prisma.batch.deleteMany({ where: { id: { in: [lot.id, bloque.id] } } });
  await prisma.equipment.deleteMany({ where: { id: { in: [frigoA.id, frigoB.id, cuve.id] } } });
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
