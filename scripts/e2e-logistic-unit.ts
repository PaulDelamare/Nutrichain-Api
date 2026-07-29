/**
 * E2E — unité logistique (palette) contre PostgreSQL réel.
 *
 * Prouve : une palette reçoit son SSCC à la palettisation (avant toute expédition), son contenu
 * est persisté, un AggregationEvent EPCIS `packing` est écrit, un maillon d'audit est scellé, et
 * le SSCC se rescanne — y compris le lendemain, puisque rien ne dépend d'une expédition. Prouve
 * aussi qu'on la RANGE en un geste (ses lots suivent, sans changer de statut), que le geste est
 * idempotent, qu'un lot déplacé seul quitte la palette, et le cloisonnement : le SSCC d'une autre
 * organisation est introuvable.
 *
 * Pré-requis : Postgres + migrations + seed. Lancement : npm run e2e:logistic-unit
 */
import { prisma } from '../src/shared/configs/prismaClient.config';
import { logisticUnitService } from '../src/modules/logistics/logisticUnits/services/logisticUnit.service';
import { batchService } from '../src/modules/logistics/shared/services/batch.service';

const ORG_ID = process.env.API_KEY_ORG_ID;
const failures: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}`);
    failures.push(label);
  }
}

async function main(): Promise<void> {
  if (!ORG_ID) throw new Error('API_KEY_ORG_ID manquant dans .env');

  const stamp = Date.now().toString().slice(-8);
  const member = await prisma.member.findFirstOrThrow({ where: { organizationId: ORG_ID } });
  const unit = await prisma.unit.findFirstOrThrow();
  const product = await prisma.product.findFirstOrThrow({ where: { organization_id: ORG_ID } });

  const makeBatch = (statut: string) =>
    prisma.batch.create({
      data: {
        organization_id: ORG_ID!,
        id_produit: product.id,
        lot_number: `E2E-LU-${stamp}-${statut}`,
        quantite_actuelle: 80,
        quantite_base: 80,
        unite_code: unit.code,
        statut,
        created_by: member.userId,
      },
    });

  const lotA = await makeBatch('EN_STOCK');
  const lotB = await makeBatch('EN_ATTENTE_QC');
  const lotBloque = await makeBatch('BLOQUE');

  console.log('\n[E2E] 1 — constituer une palette AVANT toute expédition');
  const pallet = await logisticUnitService.createLogisticUnit({
    organizationId: ORG_ID,
    userId: member.userId,
    items: [
      { id_lot: lotA.id, quantite: 30 },
      { id_lot: lotB.id, quantite: 20 },
    ],
  });
  assert(/^\d{18}$/.test(pallet.sscc), `le SSCC fait 18 chiffres (${pallet.sscc})`);

  const shipmentsForPallet = await prisma.liaison_Shipment.count({
    where: { id_unite_logistique: pallet.id },
  });
  assert(shipmentsForPallet === 0, 'la palette existe sans aucune expédition — c’est tout le sujet');

  console.log('\n[E2E] 2 — le contenu est persisté, avec ses quantités');
  const contents = await prisma.logistic_Unit_Content.findMany({
    where: { id_unite_logistique: pallet.id },
    orderBy: { id_lot: 'asc' },
  });
  assert(contents.length === 2, 'deux lots sur la palette');
  assert(
    contents.every((c) => Number(c.quantite) > 0),
    'chaque ligne porte une quantité'
  );

  console.log('\n[E2E] 3 — un AggregationEvent EPCIS est écrit au bizStep packing');
  const event = await prisma.ePCIS_Event.findFirst({
    where: { organization_id: ORG_ID, related_entity: 'Logistic_Unit', related_id: pallet.id },
  });
  assert(event !== null, 'un événement EPCIS existe pour la palette');
  const payload = (event?.payload ?? {}) as { bizStep?: string; parentID?: string; action?: string };
  assert(payload.bizStep === 'urn:epcglobal:cbv:bizstep:packing', 'bizStep = packing');
  assert(payload.action === 'ADD', 'action = ADD');
  assert(
    typeof payload.parentID === 'string' && payload.parentID.startsWith('urn:epc:id:sscc:'),
    'parentID est l’URN SSCC de la palette'
  );

  console.log('\n[E2E] 4 — la palettisation est scellée dans la chaîne d’audit');
  const audit = await prisma.audit_Log.findFirst({
    where: { organization_id: ORG_ID, action: 'CREATE_LOGISTIC_UNIT', entity_id: pallet.id },
  });
  assert(audit !== null, 'un maillon d’audit CREATE_LOGISTIC_UNIT existe');

  console.log('\n[E2E] 5 — le SSCC se rescanne et rend le contenu');
  const scanned = await logisticUnitService.resolveBySscc(pallet.sscc, ORG_ID);
  assert(scanned.sscc === pallet.sscc, 'le scan retrouve la palette');
  assert(scanned.lots.length === 2, 'le scan rend ses deux lots');
  assert(scanned.contient_lot_rappele === false, 'aucun lot rappelé pour l’instant');

  console.log('\n[E2E] 5b — ranger la palette : ses deux lots suivent, en un seul geste');
  const frigo = await prisma.equipment.findFirstOrThrow({
    where: { organization_id: ORG_ID, type: { in: ['FRIGO', 'CONGELATEUR', 'ETAGERE'] } },
  });
  const ranged = await logisticUnitService.moveLogisticUnit(
    pallet.id,
    ORG_ID,
    member.userId,
    frigo.id
  );
  assert(ranged.lots_deplaces === 2, 'les deux lots de la palette ont suivi');
  const positions = await prisma.batch.findMany({
    where: { id: { in: [lotA.id, lotB.id] } },
    select: { id_materiel_actuel: true, statut: true },
  });
  assert(
    positions.every((p) => p.id_materiel_actuel === frigo.id),
    'chaque lot porte désormais la position de la palette'
  );
  assert(
    positions.some((p) => p.statut === 'EN_ATTENTE_QC'),
    'ranger ne change aucun statut : le lot en attente de contrôle l’est toujours'
  );
  const rangedAudit = await prisma.audit_Log.findFirst({
    where: { organization_id: ORG_ID, action: 'MOVE_LOGISTIC_UNIT', entity_id: pallet.id },
  });
  assert(rangedAudit !== null, 'le rangement est scellé dans la chaîne d’audit');

  console.log('\n[E2E] 5c — idempotent : ranger au même endroit ne réécrit rien');
  const again = await logisticUnitService.moveLogisticUnit(
    pallet.id,
    ORG_ID,
    member.userId,
    frigo.id
  );
  assert(again.lots_deplaces === 0, 'aucun lot déplacé une seconde fois');

  console.log('\n[E2E] 5d — un lot déplacé SEUL quitte la palette');
  const autreFrigo = await prisma.equipment.findFirst({
    where: {
      organization_id: ORG_ID,
      type: { in: ['FRIGO', 'CONGELATEUR', 'ETAGERE'] },
      id: { not: frigo.id },
    },
  });
  if (autreFrigo) {
    await batchService.moveBatch(lotB.id, ORG_ID, member.userId, autreFrigo.id);
    const resteDansLaPalette = await prisma.logistic_Unit_Content.count({
      where: { id_unite_logistique: pallet.id, id_lot: lotB.id },
    });
    assert(resteDansLaPalette === 0, 'le lot sorti n’est plus déclaré sur la palette');
    const contenuRestant = await prisma.logistic_Unit_Content.count({
      where: { id_unite_logistique: pallet.id },
    });
    assert(contenuRestant === 1, 'la palette ne porte plus qu’un lot, et le dit');
  } else {
    console.log('  — ignoré : un seul emplacement de stockage en base');
  }

  console.log('\n[E2E] 6 — un lot passé en RAPPEL après coup est signalé au scan');
  await prisma.batch.update({ where: { id: lotA.id }, data: { statut: 'ALERTE' } });
  const rescanned = await logisticUnitService.resolveBySscc(pallet.sscc, ORG_ID);
  assert(rescanned.contient_lot_rappele === true, 'le scan signale le lot rappelé sur le quai');

  console.log('\n[E2E] 7 — un lot BLOQUE ne se palettise pas (409)');
  let rejectedBlocked = false;
  try {
    await logisticUnitService.createLogisticUnit({
      organizationId: ORG_ID,
      userId: member.userId,
      items: [{ id_lot: lotBloque.id, quantite: 5 }],
    });
  } catch (e) {
    rejectedBlocked = (e as { status?: number }).status === 409;
  }
  assert(rejectedBlocked, 'palettisation d’un lot en quarantaine refusée en 409');

  console.log('\n[E2E] 8 — cloisonnement : le SSCC d’une autre organisation est introuvable');
  const otherOrg = await prisma.organization.findFirst({ where: { id: { not: ORG_ID } } });
  if (otherOrg) {
    let notFound = false;
    try {
      await logisticUnitService.resolveBySscc(pallet.sscc, otherOrg.id);
    } catch (e) {
      notFound = (e as { status?: number }).status === 404;
    }
    assert(notFound, 'le SSCC ne se lit pas depuis une autre organisation (404)');
  } else {
    console.log('  — ignoré : une seule organisation en base');
  }

  // Cleanup — dans l'ordre des dépendances. Les mouvements en premier : ranger la palette et
  // sortir un lot en écrivent, et `Batch_Mouvement` référence le lot.
  const createdBatches = [lotA.id, lotB.id, lotBloque.id];
  await prisma.batch_Mouvement.deleteMany({ where: { id_lot: { in: createdBatches } } });
  await prisma.logistic_Unit_Content.deleteMany({ where: { id_unite_logistique: pallet.id } });
  await prisma.ePCIS_Event.deleteMany({ where: { related_id: pallet.id } });
  await prisma.audit_Log.deleteMany({ where: { entity_id: { in: [pallet.id, ...createdBatches] } } });
  await prisma.logistic_Unit.delete({ where: { id: pallet.id } });
  await prisma.batch.deleteMany({ where: { id: { in: createdBatches } } });
  await prisma.$disconnect();

  if (failures.length > 0) {
    console.error(`\n[E2E] ❌ ${failures.length} assertion(s) en échec.`);
    process.exit(1);
  }
  console.log('\n[E2E] ✅ toutes les assertions passent.');
}

main().catch(async (error) => {
  console.error('[E2E] erreur inattendue', error);
  await prisma.$disconnect();
  process.exit(1);
});
