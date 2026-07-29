/**
 * E2E — déplacement d'un lot (issue #73), contre PostgreSQL réel.
 *
 * Prouve : un lot EN_STOCK change d'emplacement (id_materiel_actuel mis à jour + mouvement +
 * audit) ; un lot BLOQUE s'évacue vers un stockage en restant BLOQUE, `statut_avant_blocage`
 * intact (évacuer un frigo en panne) ; un lot sous RAPPEL est refusé (409) ; un matériel
 * non-stockage est refusé (400) ; le déplacement vers l'emplacement actuel est idempotent
 * (200, sans mouvement).
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

  const fridgeA = await prisma.equipment.create({
    data: {
      organization_id: ORG_ID!, nom: `E2E-MV-A-${stamp}`, type: 'FRIGO',
      id_lieu: location.id, qr_code_id: `E2E-MV-QRA-${stamp}`,
    },
  });
  const fridgeB = await prisma.equipment.create({
    data: {
      organization_id: ORG_ID!, nom: `E2E-MV-B-${stamp}`, type: 'ETAGERE',
      id_lieu: location.id, qr_code_id: `E2E-MV-QRB-${stamp}`,
    },
  });
  const tank = await prisma.equipment.create({
    data: {
      organization_id: ORG_ID!, nom: `E2E-MV-CUVE-${stamp}`, type: 'CUVE',
      id_lieu: location.id, qr_code_id: `E2E-MV-QRC-${stamp}`,
    },
  });

  const makeBatch = (status: string, equipmentId: string) =>
    prisma.batch.create({
      data: {
        organization_id: ORG_ID!, id_produit: product.id, lot_number: `E2E-MV-${stamp}-${status}`,
        quantite_actuelle: 50, quantite_base: 50, unite_code: unit.code, statut: status,
        id_materiel_actuel: equipmentId, created_by: member.userId,
      },
    });

  const batch = await makeBatch('EN_STOCK', fridgeA.id);
  const blockedBatch = await makeBatch('BLOQUE', fridgeA.id);

  console.log('\n[E2E] 1 — un lot EN_STOCK se déplace de A vers B');
  await batchService.moveBatch(batch.id, ORG_ID!, member.userId, fridgeB.id);
  const after = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
  assert(after.id_materiel_actuel === fridgeB.id, 'position mise à jour vers le frigo B');
  const movement = await prisma.batch_Mouvement.findFirst({
    where: { id_lot: batch.id, type_action: 'DEPLACEMENT' },
  });
  assert(movement !== null, 'un mouvement DEPLACEMENT est tracé');

  console.log('\n[E2E] 2 — déplacer vers l’emplacement actuel est idempotent (pas de 2e mouvement)');
  await batchService.moveBatch(batch.id, ORG_ID!, member.userId, fridgeB.id);
  const movementCount = await prisma.batch_Mouvement.count({
    where: { id_lot: batch.id, type_action: 'DEPLACEMENT' },
  });
  assert(movementCount === 1, 'toujours un seul mouvement DEPLACEMENT (no-op)');

  console.log('\n[E2E] 3 — un lot BLOQUE s’évacue vers un stockage, sans perdre sa quarantaine');
  await batchService.moveBatch(blockedBatch.id, ORG_ID!, member.userId, fridgeB.id);
  const evacuated = await prisma.batch.findUniqueOrThrow({ where: { id: blockedBatch.id } });
  assert(evacuated.id_materiel_actuel === fridgeB.id, 'le lot bloqué a changé d’emplacement');
  assert(evacuated.statut === 'BLOQUE', 'il reste BLOQUE : évacuer n’est pas lever la quarantaine');
  assert(
    evacuated.statut_avant_blocage === blockedBatch.statut_avant_blocage,
    'statut_avant_blocage intact — sinon la levée le rendrait disponible à tort'
  );
  const evacuationMovement = await prisma.batch_Mouvement.findFirst({
    where: { id_lot: blockedBatch.id, type_action: 'DEPLACEMENT' },
  });
  assert(evacuationMovement !== null, 'l’évacuation est tracée par un mouvement DEPLACEMENT');
  const evacuationAudit = await prisma.audit_Log.findFirst({
    where: { organization_id: ORG_ID!, action: 'MOVE_BATCH', entity_id: blockedBatch.id },
  });
  assert(evacuationAudit !== null, 'l’évacuation est scellée dans la chaîne d’audit');

  console.log('\n[E2E] 3b — un lot sous RAPPEL reste immobilisé (409)');
  const recalledBatch = await makeBatch('ALERTE', fridgeA.id);
  let rejectedRecalled = false;
  try {
    await batchService.moveBatch(recalledBatch.id, ORG_ID!, member.userId, fridgeB.id);
  } catch (e) {
    rejectedRecalled = (e as { status?: number }).status === 409;
  }
  assert(rejectedRecalled, 'déplacement d’un lot sous rappel refusé en 409');

  console.log('\n[E2E] 4 — on ne range pas un lot dans une CUVE (400)');
  let rejectedTank = false;
  try {
    await batchService.moveBatch(batch.id, ORG_ID!, member.userId, tank.id);
  } catch (e) {
    rejectedTank = (e as { status?: number }).status === 400;
  }
  assert(rejectedTank, 'déplacement vers une CUVE refusé en 400');

  // Cleanup
  const createdBatches = [batch.id, blockedBatch.id, recalledBatch.id];
  await prisma.batch_Mouvement.deleteMany({ where: { id_lot: { in: createdBatches } } });
  await prisma.batch.deleteMany({ where: { id: { in: createdBatches } } });
  await prisma.equipment.deleteMany({ where: { id: { in: [fridgeA.id, fridgeB.id, tank.id] } } });
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
