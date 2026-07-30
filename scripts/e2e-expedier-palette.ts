/**
 * E2E — expédier une palette entière, contre PostgreSQL réel.
 *
 * Prouve l'étape 3 de #284 : on charge un CONTENANT, pas une liste de lots. Son contenu devient
 * les lignes du bon, chaque liaison porte la palette, et la palette se vide — c'est le seul cas
 * où l'origine de la marchandise est certaine (cf. #297). Prouve aussi qu'elle ne repart pas
 * deux fois, et qu'un rescan de son SSCC dit dans quelle expédition elle est partie.
 *
 * Pré-requis : Postgres + migrations + seed. Lancement : npm run e2e:expedier-palette
 */
import { prisma } from '../src/shared/configs/prismaClient.config';
import { logisticUnitService } from '../src/modules/logistics/logisticUnits/services/logisticUnit.service';
import { shipmentService } from '../src/modules/logistics/shipments/services/shipment.service';

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

async function main(): Promise<{ lots: string[]; palletId: string; shipmentId: string }> {
  if (!ORG_ID) throw new Error('API_KEY_ORG_ID manquant dans .env');

  const stamp = Date.now().toString().slice(-8);
  const member = await prisma.member.findFirstOrThrow({ where: { organizationId: ORG_ID } });
  const unit = await prisma.unit.findFirstOrThrow();
  const product = await prisma.product.findFirstOrThrow({ where: { organization_id: ORG_ID } });
  const client = await prisma.customer.findFirstOrThrow({
    where: { organization_id: ORG_ID, is_active: true },
  });

  const makeBatch = (suffix: string) =>
    prisma.batch.create({
      data: {
        organization_id: ORG_ID!,
        id_produit: product.id,
        lot_number: `E2E-EXP-${stamp}-${suffix}`,
        quantite_actuelle: 80,
        quantite_base: 80,
        unite_code: unit.code,
        statut: 'EN_STOCK',
        created_by: member.userId,
      },
    });

  const lotA = await makeBatch('A');
  const lotB = await makeBatch('B');

  console.log('\n[E2E] 1 — constituer la palette');
  const pallet = await logisticUnitService.createLogisticUnit({
    organizationId: ORG_ID,
    userId: member.userId,
    items: [
      { id_lot: lotA.id, quantite: 30 },
      { id_lot: lotB.id, quantite: 20 },
    ],
  });
  assert(/^\d{18}$/.test(pallet.sscc), `la palette porte son SSCC (${pallet.sscc})`);

  console.log('\n[E2E] 2 — expédier la PALETTE, en scannant son étiquette');
  // Le code lu porte son AI `00` : c'est ce que rend une caméra.
  const shipment = await shipmentService.createShipment({
    organization_id: ORG_ID,
    id_client: client.id,
    shipment_id: `E2E-EXP-${stamp}`,
    transporteur: 'Transporteur E2E',
    destination_adresse: '1 quai des Palettes, Paris',
    date_envoi: new Date(),
    created_by: member.userId,
    items: [],
    palettes: [`00${pallet.sscc}`],
  });

  const liaisons = await prisma.liaison_Shipment.findMany({
    where: { id_expedition: shipment.id },
    orderBy: { id_lot: 'asc' },
  });
  assert(liaisons.length === 2, 'les deux lots de la palette sont sur le bon');
  assert(
    liaisons.every((l) => l.id_unite_logistique === pallet.id),
    'chaque liaison nomme la palette — un rappel saura quel contenant retirer'
  );
  assert(
    liaisons.every((l) => Number(l.quantite_expediee) === (l.id_lot === lotA.id ? 30 : 20)),
    'les quantités expédiées sont celles que la palette portait'
  );

  console.log('\n[E2E] 3 — la palette est vidée : l’origine était certaine (#297)');
  const restant = await prisma.logistic_Unit_Content.count({
    where: { id_unite_logistique: pallet.id },
  });
  assert(restant === 0, 'la palette ne déclare plus rien');
  const stocks = await prisma.batch.findMany({
    where: { id: { in: [lotA.id, lotB.id] } },
    select: { id: true, quantite_actuelle: true },
  });
  assert(
    stocks.every((b) => Number(b.quantite_actuelle) === (b.id === lotA.id ? 50 : 60)),
    'le stock est déduit de ce qui est parti, et de rien de plus'
  );

  console.log('\n[E2E] 4 — la même palette ne repart pas une seconde fois');
  let refusee = false;
  try {
    await shipmentService.createShipment({
      organization_id: ORG_ID,
      id_client: client.id,
      shipment_id: `E2E-EXP-${stamp}-BIS`,
      transporteur: 'Transporteur E2E',
      destination_adresse: '1 quai des Palettes, Paris',
      date_envoi: new Date(),
      created_by: member.userId,
      items: [],
      palettes: [pallet.sscc],
    });
  } catch (e) {
    refusee = (e as { status?: number }).status === 409;
  }
  assert(refusee, 'une palette déjà partie est refusée en 409');

  console.log('\n[E2E] 5 — rescanner le SSCC dit où la palette est partie');
  const rescan = await logisticUnitService.resolveBySscc(pallet.sscc, ORG_ID);
  assert(rescan.lots.length === 0, 'la palette est vide');
  assert(
    rescan.expedition?.shipment_id === `E2E-EXP-${stamp}`,
    'le scan nomme l’expédition — une palette vidée ne se confond plus avec une palette jamais remplie'
  );
  assert(rescan.expedition?.client === client.nom_enseigne, 'et le client destinataire');

  console.log('\n[E2E] 6 — la palette est désagrégée : un seul contenant revendique la marchandise');
  const evenementPalette = async (action: string) =>
    prisma.ePCIS_Event.findFirst({
      where: {
        organization_id: ORG_ID,
        related_id: pallet.id,
        event_type: 'AggregationEvent',
        payload: { path: ['action'], equals: action },
      },
    });
  const desagregation = await evenementPalette('DELETE');
  const agregation = await evenementPalette('ADD');
  const parent = (p: unknown) => (p as { parentID?: string } | null)?.parentID;
  assert(desagregation !== null, 'le départ de la palette émet un AggregationEvent DELETE');
  assert(
    parent(desagregation?.payload) === parent(agregation?.payload),
    'et il referme EXACTEMENT le contenant que la palettisation avait agrégé'
  );

  console.log('\n[E2E] 7 — l’audit nomme la palette, pas seulement les lots');
  const audit = await prisma.audit_Log.findFirst({
    where: { organization_id: ORG_ID, action: 'CREATE_SHIPMENT', entity_id: shipment.id },
  });
  const payload = (audit?.nouvelle_valeur ?? {}) as { palettes?: string[] };
  assert(
    Array.isArray(payload.palettes) && payload.palettes.includes(pallet.sscc),
    'le maillon WORM porte le SSCC de la palette expédiée'
  );

  return { lots: [lotA.id, lotB.id], palletId: pallet.id, shipmentId: shipment.id };
}

/**
 * Nettoyage — enfants avant parents. Appelé depuis un `finally` : sans lui, une assertion qui
 * régresse laissait des lots et des palettes orphelins dans la base, et la violation de clé
 * étrangère remplaçait le rapport lisible par une pile Prisma.
 *
 * Les maillons d'Audit_Log ne se suppriment PAS : la chaîne est chaînée par hash, en retirer un la
 * romprait pour toute l'organisation.
 */
async function nettoyer(ids: { lots: string[]; palletId: string; shipmentId: string }): Promise<void> {
  const { lots, palletId, shipmentId } = ids;
  await prisma.batch_Mouvement.deleteMany({ where: { id_lot: { in: lots } } });
  await prisma.liaison_Shipment.deleteMany({ where: { id_expedition: shipmentId } });
  await prisma.shipment.deleteMany({ where: { id: shipmentId } });
  await prisma.logistic_Unit_Content.deleteMany({ where: { id_unite_logistique: palletId } });
  await prisma.ePCIS_Event.deleteMany({ where: { related_id: { in: [palletId, shipmentId] } } });
  await prisma.logistic_Unit.deleteMany({ where: { id: palletId } });
  await prisma.batch.deleteMany({ where: { id: { in: lots } } });
}

async function run(): Promise<void> {
  let ids: { lots: string[]; palletId: string; shipmentId: string } | null = null;
  try {
    ids = await main();
  } finally {
    // Sans ce `finally`, une assertion qui régresse laissait lots et palette orphelins en base, et
    // la violation de clé étrangère au nettoyage suivant remplaçait le rapport par une pile Prisma.
    if (ids) {
      await nettoyer(ids).catch((e) => console.error('[E2E] nettoyage incomplet :', e));
    }
    await prisma.$disconnect();
  }

  if (failures.length > 0) {
    console.error(`\n[E2E] ❌ ${failures.length} assertion(s) en échec.`);
    process.exit(1);
  }
  console.log('\n[E2E] ✅ toutes les assertions passent.');
}

run().catch(async (error) => {
  console.error('\n[E2E] Échec :', error);
  await prisma.$disconnect();
  process.exit(1);
});
