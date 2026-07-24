/**
 * E2E — la levée de quarantaine froid restaure le bon statut et refuse un lot condamné.
 *
 * Prouve, contre PostgreSQL + MongoDB réels, le correctif de la barrière HACCP :
 *  1. Un lot EN_ATTENTE_QC mis en quarantaine par une excursion froid revient EN_ATTENTE_QC à la
 *     levée — PAS EN_STOCK. Il ne devient pas expédiable au motif que l'incident frigo est résolu.
 *  2. Un lot déclaré NON CONFORME pendant la quarantaine ne se lève PAS par ce canal (409).
 *
 * Pré-requis : Postgres + migrations + seed, Mongo up, .env (API_KEY_ORG_ID).
 * Lancement : npm run e2e:quarantine-restore
 */
import { prisma } from '../src/shared/configs/prismaClient.config';
import { connectMongoDB, disconnectMongoDB } from '../src/shared/configs/mongoClient.config';
import { TelemetryModel } from '../src/modules/iot/models/telemetry.model';
import { waitForDetectableWindow } from './helpers/telemetryVisibility';
import {
  iotAlertService,
  _clearThresholdCacheForTests,
} from '../src/modules/iot/services/iotAlert.service';
import { batchService } from '../src/modules/logistics/shared/services/batch.service';
import { qualityControlService } from '../src/modules/organization/services/qualityControl.service';

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

async function ingestExcursion(sensorId: string, seuil: number) {
  const now = Date.now();
  const docs = Array.from({ length: 10 }, (_, i) => ({
    metadata: { sensor_id: sensorId, organization_id: ORG_ID! },
    timestamp: new Date(now - (10 - i) * 60_000),
    temperature: seuil + 4,
    humidity: 60,
    battery_level: 90,
  }));
  await TelemetryModel.insertMany(docs);
  // La détection lit une fenêtre, pas le dernier point : sur le runner CI, une lecture immédiate
  // après l'écriture voit une fenêtre incomplète et conclut « aucune excursion » → le lot reste
  // EN_ATTENTE_QC au lieu de BLOQUE, et la levée qui suit échoue en 409. On attend d'abord que les
  // 10 points soient relisibles sur le prédicat même de la détection.
  await waitForDetectableWindow(sensorId, ORG_ID!, docs.length);
  _clearThresholdCacheForTests();
  await iotAlertService.checkAndAlert({
    sensorId,
    organizationId: ORG_ID!,
    currentTemp: seuil + 4,
    timestamp: new Date(now),
  });
}

async function main() {
  await connectMongoDB();
  const stamp = Date.now();

  // Deux acteurs distincts : la séparation des tâches interdit au producteur de lever sa propre
  // quarantaine. Le leveur (décideur qualité) doit être un autre membre.
  const membres = await prisma.member.findMany({
    where: { organizationId: ORG_ID!, role: { in: ['owner', 'admin', 'quality'] } },
    take: 2,
  });
  if (membres.length < 2) throw new Error('Il faut au moins 2 membres habilités dans le seed.');
  const producteur = membres[0].userId;
  const leveur = membres[1].userId;

  const produit = await prisma.product.findFirst({ where: { organization_id: ORG_ID! } });
  const unite = await prisma.unit.findFirst();
  if (!produit || !unite) throw new Error('Produit ou unité absent du seed.');

  const location = await prisma.location.create({
    data: { organization_id: ORG_ID!, nom: `E2E-QR-Loc-${stamp}`, type: 'COLD_STORAGE' },
  });
  const frigo = await prisma.equipment.create({
    data: {
      organization_id: ORG_ID!,
      nom: `E2E-QR-Frigo-${stamp}`,
      type: 'FRIGO',
      id_lieu: location.id,
      sensor_id: `E2E-QR-SENSOR-${stamp}`,
      temp_seuil_max: 4,
      qr_code_id: `E2E-QR-CODE-${stamp}`,
    },
  });

  const makeBatch = (suffix: string) =>
    prisma.batch.create({
      data: {
        organization_id: ORG_ID!,
        id_produit: produit.id,
        lot_number: `E2E-QR-${stamp}-${suffix}`,
        quantite_actuelle: 100,
        quantite_base: 100,
        unite_code: unite.code,
        statut: 'EN_ATTENTE_QC',
        id_materiel_actuel: frigo.id,
        created_by: producteur,
      },
    });

  // ---- Scénario 1 : restauration du statut ----
  console.log('\n[E2E] Scénario 1 — un lot EN_ATTENTE_QC revient EN_ATTENTE_QC à la levée');
  const lot1 = await makeBatch('RESTORE');
  await ingestExcursion(frigo.sensor_id!, 4);

  const apresExcursion = await prisma.batch.findUniqueOrThrow({ where: { id: lot1.id } });
  assert(apresExcursion.statut === 'BLOQUE', 'excursion → lot BLOQUE');
  assert(
    apresExcursion.statut_avant_blocage === 'EN_ATTENTE_QC',
    'statut_avant_blocage mémorise EN_ATTENTE_QC'
  );

  await batchService.liftQuarantine(lot1.id, ORG_ID!, leveur, 'Frigo réparé, chaîne du froid OK');
  const apresLevee = await prisma.batch.findUniqueOrThrow({ where: { id: lot1.id } });
  assert(
    apresLevee.statut === 'EN_ATTENTE_QC',
    'levée → lot revient EN_ATTENTE_QC (barrière HACCP préservée)'
  );
  assert(apresLevee.statut !== 'EN_STOCK', 'levée → lot N EST PAS remis en stock (bug d origine)');
  assert(apresLevee.statut_avant_blocage === null, 'statut_avant_blocage remis à null');

  // ---- Scénario 2 : lot condamné, levée refusée ----
  console.log('\n[E2E] Scénario 2 — un lot condamné par un contrôle non conforme ne se lève pas');
  const lot2 = await makeBatch('CONDAMNE');
  await ingestExcursion(frigo.sensor_id!, 4);
  await qualityControlService.createQualityControl({
    organization_id: ORG_ID!,
    id_lot: lot2.id,
    type_test: 'Analyse microbiologique',
    resultat: 'NON_CONFORME',
    id_user_labo: leveur,
  });

  let refuse = false;
  try {
    await batchService.liftQuarantine(lot2.id, ORG_ID!, leveur, 'Tentative de levée');
  } catch (e) {
    refuse = (e as { status?: number }).status === 409;
  }
  assert(refuse, 'levée d un lot condamné → refusée en 409');
  const lot2Final = await prisma.batch.findUniqueOrThrow({ where: { id: lot2.id } });
  assert(lot2Final.statut === 'BLOQUE', 'lot condamné reste BLOQUE, jamais libéré');

  // ---- Cleanup ----
  await prisma.batch_Mouvement.deleteMany({ where: { id_lot: { in: [lot1.id, lot2.id] } } });
  await prisma.qualityControl.deleteMany({ where: { id_lot: { in: [lot1.id, lot2.id] } } });
  await prisma.batch.deleteMany({ where: { id: { in: [lot1.id, lot2.id] } } });
  await prisma.alert.deleteMany({ where: { id_materiel: frigo.id } });
  await prisma.equipment.delete({ where: { id: frigo.id } });
  await prisma.location.delete({ where: { id: location.id } });
  await TelemetryModel.deleteMany({ 'metadata.sensor_id': frigo.sensor_id });

  await disconnectMongoDB();
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
