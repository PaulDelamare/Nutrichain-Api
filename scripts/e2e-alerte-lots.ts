/**
 * E2E — « la levée d'une alerte froid ne relâche QUE les lots de cette alerte ».
 *
 * Le bug réparé : les clients (mobile, front) reconstituaient les lots d'une alerte en filtrant
 * `GET /organization/quarantine-batches` — qui renvoie TOUS les lots BLOQUE de l'organisation — sur
 * l'équipement de l'alerte. Un lot bloqué par un contrôle qualité SANS RAPPORT (corps étranger,
 * DLC), mais rangé dans le même frigo, s'y retrouvait. « Enregistrer sans isolation » le remettait
 * donc en stock : un RELÂCHEMENT NON CONSENTI.
 *
 * Ce script monte la scène pour de vrai (vraie base, vraie ingestion capteur, vrai service
 * d'alerte) et vérifie que le nouvel endpoint ne voit QUE les bons lots.
 *
 * Le frigo contient trois lots :
 *   - FROID-STOCK : EN_STOCK        → le froid l'isole      → doit être listé, levable
 *   - FROID-QC    : EN_ATTENTE_QC   → le froid l'isole      → doit être listé, levable
 *   - INTRUS-QC   : déjà BLOQUE par un contrôle non conforme → NE DOIT PAS être listé
 *
 * Puis on déclare FROID-STOCK non conforme APRÈS son isolement : il doit rester listé mais devenir
 * NON levable (isolé par le froid ET impropre — réparer le frigo ne le rend pas consommable).
 *
 * Lancement : npm run e2e:alerte-lots
 */
import { prisma } from '../src/shared/configs/prismaClient.config';
import { connectMongoDB, disconnectMongoDB } from '../src/shared/configs/mongoClient.config';
import { TelemetryModel } from '../src/modules/iot/models/telemetry.model';
import {
  iotAlertService,
  _clearThresholdCacheForTests,
} from '../src/modules/iot/services/iotAlert.service';
import { alertBatchService } from '../src/modules/alerts/services/alertBatch.service';
import {
  BATCH_STATUSES,
  MOVEMENT_TYPES,
  QUALITY_RESULTS,
} from '../src/modules/logistics/constants/logistics.constants';

const ORG_ID = process.env.API_KEY_ORG_ID;
if (!ORG_ID) {
  console.error('[E2E] API_KEY_ORG_ID requis dans .env');
  process.exit(1);
}

const failures: string[] = [];
function assert(condition: boolean, label: string) {
  if (condition) console.log(`  ✅ ${label}`);
  else {
    failures.push(label);
    console.error(`  ❌ ${label}`);
  }
}

interface Fixtures {
  equipmentId: string;
  sensorId: string;
  batchIds: string[];
  froidStock: string;
  froidQc: string;
  intrusQc: string;
}

async function setup(): Promise<Fixtures> {
  const stamp = Date.now();
  const sensorId = `E2E-LOTS-${stamp}`;

  const location =
    (await prisma.location.findFirst({ where: { organization_id: ORG_ID! } })) ??
    (await prisma.location.create({
      data: { organization_id: ORG_ID!, nom: `E2E-Loc-${stamp}`, type: 'WAREHOUSE' },
    }));

  const equipment = await prisma.equipment.create({
    data: {
      organization_id: ORG_ID!,
      nom: `E2E-Frigo-lots-${stamp}`,
      type: 'FRIGO',
      id_lieu: location.id,
      sensor_id: sensorId,
      temp_seuil_max: 4,
      qr_code_id: `QR-${sensorId}`,
    },
  });

  const produit = await prisma.product.findFirst({ where: { organization_id: ORG_ID! } });
  const user = await prisma.member.findFirst({
    where: { organizationId: ORG_ID! },
    select: { userId: true },
  });
  if (!produit || !user) throw new Error('Seed manquant : il faut un produit et un membre.');

  const makeBatch = async (lotNumber: string, statut: string) =>
    prisma.batch.create({
      data: {
        organization_id: ORG_ID!,
        lot_number: lotNumber,
        id_produit: produit.id,
        quantite_actuelle: 10,
        quantite_base: 10,
        unite_code: produit.unite_reference,
        statut,
        id_materiel_actuel: equipment.id,
        created_by: user.userId,
      },
    });

  const froidStock = await makeBatch(`E2E-FROID-STOCK-${stamp}`, BATCH_STATUSES.IN_STOCK);
  const froidQc = await makeBatch(`E2E-FROID-QC-${stamp}`, BATCH_STATUSES.PENDING_QC);
  const intrusQc = await makeBatch(`E2E-INTRUS-QC-${stamp}`, BATCH_STATUSES.BLOCKED);

  // L'INTRUS : bloqué par un contrôle qualité, bien avant toute excursion. Il est dans le frigo,
  // mais il n'a rien à voir avec la chaîne du froid.
  await prisma.batch_Mouvement.create({
    data: {
      id_lot: intrusQc.id,
      type_action: MOVEMENT_TYPES.QUALITY_CONTROL,
      quantite: 10,
      unite: produit.unite_reference,
      metadata: {
        resultat: QUALITY_RESULTS.NON_CONFORM,
        type_test: 'CORPS_ETRANGER',
        statut_precedent: BATCH_STATUSES.IN_STOCK,
        statut_resultant: BATCH_STATUSES.BLOCKED,
      },
    },
  });

  console.log(`  → frigo=${equipment.id} | 3 lots posés (dont 1 intrus bloqué qualité)`);
  return {
    equipmentId: equipment.id,
    sensorId,
    batchIds: [froidStock.id, froidQc.id, intrusQc.id],
    froidStock: froidStock.id,
    froidQc: froidQc.id,
    intrusQc: intrusQc.id,
  };
}

async function cleanup(f: Fixtures) {
  await prisma.batch_Mouvement.deleteMany({ where: { id_lot: { in: f.batchIds } } });
  await prisma.batch.deleteMany({ where: { id: { in: f.batchIds } } });
  await prisma.alert.deleteMany({ where: { id_materiel: f.equipmentId } });
  // ⚠️ On ne touche PAS à `Audit_Log` : c'est une chaîne de hachage WORM. En retirer un maillon la
  // casserait. Deux lignes de bruit en base valent mieux qu'un audit invérifiable.
  await prisma.equipment.delete({ where: { id: f.equipmentId } });
  await TelemetryModel.deleteMany({ 'metadata.sensor_id': f.sensorId });
  console.log('  → fixtures supprimées');
}

async function ingestPing(sensorId: string, temperature: number, minutesAgo: number) {
  const ts = new Date(Date.now() - minutesAgo * 60_000);
  await TelemetryModel.create({
    metadata: { sensor_id: sensorId, organization_id: ORG_ID! },
    timestamp: ts,
    temperature,
    humidity: 50,
    battery_level: 80,
  });
  await iotAlertService.checkAndAlert({
    sensorId,
    organizationId: ORG_ID!,
    currentTemp: temperature,
    timestamp: ts,
  });
}

async function main() {
  console.log(`[E2E] Lots d'une alerte froid — org ${ORG_ID}`);
  await connectMongoDB();

  let fixtures: Fixtures | null = null;
  try {
    console.log('\n[Setup]');
    fixtures = await setup();
    _clearThresholdCacheForTests();
    await TelemetryModel.deleteMany({ 'metadata.sensor_id': fixtures.sensorId });

    console.log('\n[1] Excursion thermique : 10 pings à 8 °C (seuil 4 °C)');
    for (let i = 9; i >= 0; i--) await ingestPing(fixtures.sensorId, 8, i);

    const alert = await prisma.alert.findFirst({
      where: { id_materiel: fixtures.equipmentId, type: 'TEMP_EXCURSION', statut: 'ACTIVE' },
    });
    assert(alert !== null, "l'excursion a bien créé une alerte");
    if (!alert) throw new Error('pas d’alerte : la suite du scénario n’a plus de sens');

    const statutOf = async (id: string) =>
      (await prisma.batch.findUniqueOrThrow({ where: { id }, select: { statut: true } })).statut;

    assert(
      (await statutOf(fixtures.froidStock)) === BATCH_STATUSES.BLOCKED &&
        (await statutOf(fixtures.froidQc)) === BATCH_STATUSES.BLOCKED,
      'le froid a isolé les deux lots qui étaient rangés dans le frigo'
    );

    console.log("\n[2] Les lots de l'alerte — c'est ICI que se jouait le relâchement non consenti");

    // La MÉTHODE D'AVANT, rejouée telle quelle : tous les lots BLOQUE rangés dans cet équipement.
    // Sans cette mesure, le test ne prouverait pas qu'il y avait un bug — seulement qu'il n'y en a
    // plus. Elle doit ramasser les 3 lots, intrus compris : c'est exactement ce qu'on relâchait.
    const ancienneListe = await prisma.batch.findMany({
      where: {
        organization_id: ORG_ID!,
        statut: BATCH_STATUSES.BLOCKED,
        id_materiel_actuel: fixtures.equipmentId,
      },
      select: { id: true },
    });
    assert(
      ancienneListe.length === 3 && ancienneListe.some((b) => b.id === fixtures!.intrusQc),
      `l'ancienne méthode ramassait ${ancienneListe.length} lots, dont l'intrus — le bug est réel`
    );

    let batches = await alertBatchService.listBatchesIsolatedByAlert(alert);
    const ids = batches.map((b) => b.id);

    assert(ids.includes(fixtures.froidStock), 'le lot EN_STOCK isolé par le froid est listé');
    assert(ids.includes(fixtures.froidQc), 'le lot EN_ATTENTE_QC isolé par le froid est listé');
    assert(
      !ids.includes(fixtures.intrusQc),
      "LE BUG : le lot bloqué par un contrôle qualité SANS RAPPORT n'est PAS listé"
    );
    assert(batches.length === 2, `exactement 2 lots (reçu ${batches.length})`);
    assert(
      batches.every((b) => b.levable && b.motif_blocage === null),
      'les deux sont levables : rien ne s’oppose à leur remise en stock'
    );

    console.log('\n[3] Le labo déclare le lot EN_STOCK non conforme, APRÈS son isolement');
    await prisma.batch_Mouvement.create({
      data: {
        id_lot: fixtures.froidStock,
        type_action: MOVEMENT_TYPES.QUALITY_CONTROL,
        quantite: 10,
        unite: batches[0]!.unite_code,
        metadata: { resultat: QUALITY_RESULTS.NON_CONFORM, type_test: 'LISTERIA' },
      },
    });

    batches = await alertBatchService.listBatchesIsolatedByAlert(alert);
    const condamne = batches.find((b) => b.id === fixtures!.froidStock);
    const intact = batches.find((b) => b.id === fixtures!.froidQc);

    assert(
      condamne?.levable === false && condamne.motif_blocage === 'CONTROLE_NON_CONFORME',
      'il reste listé mais n’est plus levable : réparer le frigo ne le rend pas consommable'
    );
    assert(
      intact?.levable === true,
      'la non-conformité de son voisin ne contamine pas l’autre lot'
    );
    console.log("\n[4] Le lot est relâché, puis une NOUVELLE excursion le ré-isole");
    // Le piège que la première version de ce service n'avait pas vu : croiser un fait HISTORIQUE
    // (« cette alerte a isolé ce lot ») avec un fait PRÉSENT (« ce lot est bloqué ») sans vérifier
    // que le blocage actuel est bien celui-là. L'alerte A ne doit plus revendiquer un lot que
    // l'alerte B retient — sinon rouvrir A relâche la marchandise que B protège.
    await prisma.batch_Mouvement.create({
      data: {
        id_lot: fixtures.froidQc,
        type_action: MOVEMENT_TYPES.QUARANTINE_LIFTED,
        quantite: 10,
        unite: batches[0]!.unite_code,
        metadata: { motif: 'frigo réparé' },
      },
    });
    await prisma.batch.update({
      where: { id: fixtures.froidQc },
      data: { statut: BATCH_STATUSES.IN_STOCK },
    });

    // Nouvelle excursion → nouvelle alerte B (l'ancienne n'est plus ACTIVE, le dédup ne bloque pas).
    await prisma.alert.updateMany({
      where: { id: alert.id },
      data: { statut: 'RESOLVED', resolved_at: new Date() },
    });
    _clearThresholdCacheForTests();
    await TelemetryModel.deleteMany({ 'metadata.sensor_id': fixtures.sensorId });
    for (let i = 9; i >= 0; i--) await ingestPing(fixtures.sensorId, 9, i);

    const alerteB = await prisma.alert.findFirst({
      where: { id_materiel: fixtures.equipmentId, type: 'TEMP_EXCURSION', statut: 'ACTIVE' },
    });
    assert(alerteB !== null && alerteB.id !== alert.id, 'une SECONDE alerte a bien été créée');

    const sousA = await alertBatchService.listBatchesIsolatedByAlert(alert);
    assert(
      !sousA.some((b) => b.id === fixtures!.froidQc),
      "l'ancienne alerte ne revendique plus le lot que la NOUVELLE retient"
    );
    if (alerteB) {
      const sousB = await alertBatchService.listBatchesIsolatedByAlert(alerteB);
      assert(
        sousB.some((b) => b.id === fixtures!.froidQc),
        "c'est la nouvelle alerte qui le porte désormais"
      );
    }

    console.log('\n[5] Un rappel produit ne doit pas répondre « aucun lot »');
    const rappel = await prisma.alert.create({
      data: {
        organization_id: ORG_ID!,
        type: 'PRODUCT_RECALL',
        niveau_gravite: 'PANIC',
        message: 'E2E rappel',
        statut: 'ACTIVE',
      },
    });
    try {
      await alertBatchService.listBatchesIsolatedByAlert(rappel);
      assert(false, 'un rappel produit est refusé (il ne renvoie pas une liste vide)');
    } catch {
      assert(true, 'un rappel produit est refusé (il ne renvoie pas une liste vide)');
    }
    await prisma.alert.delete({ where: { id: rappel.id } });
  } finally {
    if (fixtures) {
      console.log('\n[Cleanup]');
      await cleanup(fixtures);
    }
    await disconnectMongoDB();
    await prisma.$disconnect();
  }

  console.log(
    failures.length === 0
      ? '\n✅ E2E OK — la levée ne peut plus relâcher un lot bloqué pour une autre cause.'
      : `\n❌ ${failures.length} échec(s) :\n - ${failures.join('\n - ')}`
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
