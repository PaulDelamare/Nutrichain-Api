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
import mongoose from 'mongoose';
import { prisma } from '../src/shared/configs/prismaClient.config';
import { connectMongoDB, disconnectMongoDB } from '../src/shared/configs/mongoClient.config';
import { TelemetryModel } from '../src/modules/iot/models/telemetry.model';
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

async function ingestExcursion(sensorId: string, threshold: number) {
  const now = Date.now();
  const docs = Array.from({ length: 10 }, (_, i) => ({
    metadata: { sensor_id: sensorId, organization_id: ORG_ID! },
    timestamp: new Date(now - (10 - i) * 60_000),
    temperature: threshold + 4,
    humidity: 60,
    battery_level: 90,
  }));
  // Écriture et relecture (dans checkAndAlert) dans la MÊME session Mongo à cohérence causale,
  // comme en production (telemetry.controller.ts) : élimine le pari sur un délai de visibilité
  // arbitraire — sans elle, une lecture immédiate après l'écriture pouvait voir une fenêtre
  // incomplète et conclure « aucune excursion » (#226).
  const session = await mongoose.startSession();
  try {
    await TelemetryModel.insertMany(docs, { session });
    _clearThresholdCacheForTests();
    await iotAlertService.checkAndAlert({
      sensorId,
      organizationId: ORG_ID!,
      currentTemp: threshold + 4,
      timestamp: new Date(now),
      mongoSession: session,
    });
  } finally {
    await session.endSession();
  }
}

async function main() {
  await connectMongoDB();
  const stamp = Date.now();

  // Deux acteurs distincts : la séparation des tâches interdit au producteur de lever sa propre
  // quarantaine. Le leveur (décideur qualité) doit être un autre membre.
  const members = await prisma.member.findMany({
    where: { organizationId: ORG_ID!, role: { in: ['owner', 'admin', 'quality'] } },
    take: 2,
  });
  if (members.length < 2) throw new Error('Il faut au moins 2 membres habilités dans le seed.');
  const producer = members[0].userId;
  const lifter = members[1].userId;

  const product = await prisma.product.findFirst({ where: { organization_id: ORG_ID! } });
  const unit = await prisma.unit.findFirst();
  if (!product || !unit) throw new Error('Produit ou unité absent du seed.');

  const location = await prisma.location.create({
    data: { organization_id: ORG_ID!, nom: `E2E-QR-Loc-${stamp}`, type: 'COLD_STORAGE' },
  });
  const fridge = await prisma.equipment.create({
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
        id_produit: product.id,
        lot_number: `E2E-QR-${stamp}-${suffix}`,
        quantite_actuelle: 100,
        quantite_base: 100,
        unite_code: unit.code,
        statut: 'EN_ATTENTE_QC',
        id_materiel_actuel: fridge.id,
        created_by: producer,
      },
    });

  // ---- Scénario 1 : restauration du statut ----
  console.log('\n[E2E] Scénario 1 — un lot EN_ATTENTE_QC revient EN_ATTENTE_QC à la levée');
  const batch1 = await makeBatch('RESTORE');
  await ingestExcursion(fridge.sensor_id!, 4);

  let afterExcursion = await prisma.batch.findUniqueOrThrow({ where: { id: batch1.id } });
  // Filet de sécurité, pas un pari sur un délai Mongo : si la détection n'a pas suivi (rare, sous
  // charge CI), on renvoie une vraie excursion supplémentaire — le comportement observable (le lot
  // finit-il par être bloqué ?), pas une durée devinée en interne à Mongo (#226).
  for (let retry = 0; retry < 5 && afterExcursion.statut !== 'BLOQUE'; retry++) {
    await ingestExcursion(fridge.sensor_id!, 4);
    afterExcursion = await prisma.batch.findUniqueOrThrow({ where: { id: batch1.id } });
  }
  assert(afterExcursion.statut === 'BLOQUE', 'excursion → lot BLOQUE');
  assert(
    afterExcursion.statut_avant_blocage === 'EN_ATTENTE_QC',
    'statut_avant_blocage mémorise EN_ATTENTE_QC'
  );

  await batchService.liftQuarantine(batch1.id, ORG_ID!, lifter, 'Frigo réparé, chaîne du froid OK');
  const afterLift = await prisma.batch.findUniqueOrThrow({ where: { id: batch1.id } });
  assert(
    afterLift.statut === 'EN_ATTENTE_QC',
    'levée → lot revient EN_ATTENTE_QC (barrière HACCP préservée)'
  );
  assert(afterLift.statut !== 'EN_STOCK', 'levée → lot N EST PAS remis en stock (bug d origine)');
  assert(afterLift.statut_avant_blocage === null, 'statut_avant_blocage remis à null');

  // ---- Scénario 2 : lot condamné, levée refusée ----
  console.log('\n[E2E] Scénario 2 — un lot condamné par un contrôle non conforme ne se lève pas');
  const batch2 = await makeBatch('CONDAMNE');
  await ingestExcursion(fridge.sensor_id!, 4);
  await qualityControlService.createQualityControl({
    organization_id: ORG_ID!,
    id_lot: batch2.id,
    type_test: 'Analyse microbiologique',
    resultat: 'NON_CONFORME',
    id_user_labo: lifter,
  });

  let rejected = false;
  try {
    await batchService.liftQuarantine(batch2.id, ORG_ID!, lifter, 'Tentative de levée');
  } catch (e) {
    rejected = (e as { status?: number }).status === 409;
  }
  assert(rejected, 'levée d un lot condamné → refusée en 409');
  const batch2Final = await prisma.batch.findUniqueOrThrow({ where: { id: batch2.id } });
  assert(batch2Final.statut === 'BLOQUE', 'lot condamné reste BLOQUE, jamais libéré');

  // ---- Cleanup ----
  await prisma.batch_Mouvement.deleteMany({ where: { id_lot: { in: [batch1.id, batch2.id] } } });
  await prisma.qualityControl.deleteMany({ where: { id_lot: { in: [batch1.id, batch2.id] } } });
  await prisma.batch.deleteMany({ where: { id: { in: [batch1.id, batch2.id] } } });
  await prisma.alert.deleteMany({ where: { id_materiel: fridge.id } });
  await prisma.equipment.delete({ where: { id: fridge.id } });
  await prisma.location.delete({ where: { id: location.id } });
  await TelemetryModel.deleteMany({ 'metadata.sensor_id': fridge.sensor_id });

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
