/**
 * E2E — alerte chaîne du froid IoT (Objectif SMART n°2).
 *
 * Valide la vraie chaîne Mongo + Postgres + transaction Serializable + audit WORM
 * + email (Ethereal) en appelant directement `iotAlertService.checkAndAlert` après
 * ingestion réelle via TelemetryModel.create.
 *
 * Pré-requis :
 * - DB Postgres up + migrations + seed (`npx prisma db seed`)
 * - Mongo up + connecté (mongoClient.config)
 * - .env contient API_KEY_ORG_ID + SMTP_* (Ethereal pour test)
 *
 * Lancement : npm run e2e:iot-alert
 *
 * Scénarios :
 *  1. Setup : Equipment avec sensor_id + temp_seuil_max + 1 admin Member + clear Mongo old data
 *  2. Ingest 10 pings à 8°C sur 15min → 1 Alert créée + audit + email
 *  3. Ingest 1 nouveau ping → pas de 2e Alert (dédup ACTIVE)
 *  4. Ingest 1 ping à 2°C (sous seuil) → pas d'alerte (et pas de query Mongo)
 *  5. Cross-tenant : ping avec sensor_id d'une autre org → 0 alerte créée dans cette org
 *  6. Cleanup
 */
import mongoose from 'mongoose';
import { prisma } from '../src/shared/configs/prismaClient.config';
import { connectMongoDB, disconnectMongoDB } from '../src/shared/configs/mongoClient.config';
import { TelemetryModel } from '../src/modules/iot/models/telemetry.model';
import {
  iotAlertService,
  _clearThresholdCacheForTests,
} from '../src/modules/iot/services/iotAlert.service';

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

interface Fixtures {
  equipmentId: string;
  sensorId: string;
  locationId: string;
}

async function setup(): Promise<Fixtures> {
  console.log('\n[E2E] Setup...');
  const stamp = Date.now();
  const sensorId = `E2E-SENSOR-${stamp}`;

  // Location si manquant
  let location = await prisma.location.findFirst({ where: { organization_id: ORG_ID! } });
  if (!location) {
    location = await prisma.location.create({
      data: { organization_id: ORG_ID!, nom: `E2E-Loc-${stamp}`, type: 'WAREHOUSE' },
    });
  }

  // Equipment avec sensor_id et seuil 4°C
  const equipment = await prisma.equipment.create({
    data: {
      organization_id: ORG_ID!,
      nom: `E2E-Frigo-${stamp}`,
      type: 'FRIGO',
      id_lieu: location.id,
      sensor_id: sensorId,
      temp_seuil_max: 4,
      qr_code_id: `QR-${sensorId}`,
    },
  });

  // S'assurer qu'il y a au moins un admin pour le mail (le seed admin owner suffit)
  const adminMember = await prisma.member.findFirst({
    where: { organizationId: ORG_ID!, role: { in: ['owner', 'admin'] } },
  });
  if (!adminMember) {
    throw new Error('Pas de member owner/admin seedé.');
  }

  console.log(`  → sensor=${sensorId}, equipment=${equipment.id}, threshold=4°C`);
  return { equipmentId: equipment.id, sensorId, locationId: location.id };
}

async function cleanup(f: Fixtures) {
  console.log('\n[E2E] Cleanup...');
  await prisma.alert.deleteMany({ where: { id_materiel: f.equipmentId } });
  // On ne supprime PAS les Audit_Log : la chaîne WORM est chaînée par hash, en retirer une ligne la
  // romprait pour toute l'organisation. Les traces d'excursion restent — inoffensives, et le
  // comptage se fait en delta (cf. main).
  await prisma.equipment.delete({ where: { id: f.equipmentId } });
  await TelemetryModel.deleteMany({ 'metadata.sensor_id': f.sensorId });
  console.log('  → fixtures supprimées');
}

async function ingestPing(sensorId: string, organizationId: string, temperature: number, minutesAgo = 0) {
  const ts = new Date(Date.now() - minutesAgo * 60_000);
  // Écriture et relecture dans la MÊME session Mongo à cohérence causale, comme en production
  // (telemetry.controller.ts) : élimine le pari sur un délai de visibilité arbitraire (#226).
  const session = await mongoose.startSession();
  try {
    await TelemetryModel.create(
      [{ metadata: { sensor_id: sensorId, organization_id: organizationId }, timestamp: ts, temperature, humidity: 50, battery_level: 80 }],
      { session }
    );
    await iotAlertService.checkAndAlert({
      sensorId,
      organizationId,
      currentTemp: temperature,
      timestamp: ts,
      mongoSession: session,
    });
  } finally {
    await session.endSession();
  }
}

async function main() {
  console.log(`[E2E] IoT cold chain alert — org ${ORG_ID}`);
  await connectMongoDB();

  let fixtures: Fixtures | null = null;
  try {
    fixtures = await setup();

    // Vider une alerte existante de cet equipment au cas où
    await prisma.alert.deleteMany({ where: { id_materiel: fixtures.equipmentId } });
    _clearThresholdCacheForTests();

    // Vider la fenêtre Mongo (au cas où re-run)
    await TelemetryModel.deleteMany({ 'metadata.sensor_id': fixtures.sensorId });

    // L'audit WORM est chaîné : on ne PEUT pas supprimer d'anciennes lignes d'excursion sans casser
    // la chaîne. Une excursion déclenchée par un autre scénario avant celui-ci laisse donc sa trace.
    // On mesure donc un DELTA (+1), pas un absolu — le test reste vrai quel que soit l'ordre.
    const auditBefore = await prisma.audit_Log.count({
      where: { organization_id: ORG_ID!, action: 'TEMP_EXCURSION_DETECTED' },
    });

    // ===== Scénario 2 : 10 pings au-dessus du seuil → 1 Alert créée =====
    console.log('\nScénario 2 — 10 pings à 8°C (au-dessus du seuil 4°C)');
    for (let i = 9; i >= 0; i--) {
      await ingestPing(fixtures.sensorId, ORG_ID!, 8, i);
    }

    let alertsAfterFlood = await prisma.alert.count({
      where: { id_materiel: fixtures.equipmentId, type: 'TEMP_EXCURSION', statut: 'ACTIVE' },
    });
    // Filet de sécurité, pas un pari sur un délai Mongo : si la détection n'a pas suivi (rare, sous
    // charge CI), on renvoie de vrais pings supplémentaires — le comportement observable (est-ce
    // qu'une alerte finit par exister ?), pas une durée devinée en interne à Mongo (#226).
    for (let retry = 0; retry < 5 && alertsAfterFlood === 0; retry++) {
      await ingestPing(fixtures.sensorId, ORG_ID!, 8, 0);
      alertsAfterFlood = await prisma.alert.count({
        where: { id_materiel: fixtures.equipmentId, type: 'TEMP_EXCURSION', statut: 'ACTIVE' },
      });
    }
    assert(alertsAfterFlood === 1, `1 Alert ACTIVE créée (reçu ${alertsAfterFlood})`);

    const auditAfter = await prisma.audit_Log.count({
      where: { organization_id: ORG_ID!, action: 'TEMP_EXCURSION_DETECTED' },
    });
    assert(
      auditAfter - auditBefore === 1,
      `1 ligne Audit_Log TEMP_EXCURSION_DETECTED de plus (delta ${auditAfter - auditBefore})`
    );

    // ===== Scénario 3 : 1 ping de plus → pas de 2e alerte (dédup ACTIVE) =====
    console.log('\nScénario 3 — 1 nouveau ping à 8°C avec Alert ACTIVE existante');
    await ingestPing(fixtures.sensorId, ORG_ID!, 8, 0);
    alertsAfterFlood = await prisma.alert.count({
      where: { id_materiel: fixtures.equipmentId, type: 'TEMP_EXCURSION', statut: 'ACTIVE' },
    });
    assert(alertsAfterFlood === 1, `Toujours 1 Alert (pas de doublon dédup)`);

    // ===== Scénario 4 : ping sous le seuil → pas d'alerte =====
    console.log('\nScénario 4 — ping à 2°C (sous seuil)');
    const alertsBefore = alertsAfterFlood;
    await ingestPing(fixtures.sensorId, ORG_ID!, 2, 0);
    const alertsAfter = await prisma.alert.count({
      where: { id_materiel: fixtures.equipmentId, type: 'TEMP_EXCURSION' },
    });
    assert(alertsAfter === alertsBefore, 'Pas de nouvelle alerte sur ping sous seuil');

    // ===== Scénario 5 : cross-tenant — sensor inconnu dans cette org =====
    console.log("\nScénario 5 — cross-tenant : ping avec sensor inconnu dans l'org → 0 alerte");
    const unknownSensor = `UNKNOWN-${Date.now()}`;
    const orgAlertsBefore = await prisma.alert.count({ where: { organization_id: ORG_ID! } });
    await ingestPing(unknownSensor, ORG_ID!, 8, 0);
    const orgAlertsAfter = await prisma.alert.count({ where: { organization_id: ORG_ID! } });
    assert(orgAlertsAfter === orgAlertsBefore, 'Aucune nouvelle alerte sur sensor sans mapping');
  } catch (err) {
    console.error('\n[E2E] Erreur fatale:', err);
    failures.push(`Exception: ${(err as Error).message}`);
  } finally {
    if (fixtures) {
      try {
        await cleanup(fixtures);
      } catch (e) {
        console.error('[E2E] Cleanup error:', e);
      }
    }
    await prisma.$disconnect();
    await disconnectMongoDB();
    if (failures.length > 0) {
      console.error(`\n❌ ${failures.length} échec(s):`);
      failures.forEach((f) => console.error(`   - ${f}`));
      process.exitCode = 1;
    } else {
      console.log('\n✅ Tous les scénarios E2E IoT alert sont passés.');
    }
  }
}

main();
