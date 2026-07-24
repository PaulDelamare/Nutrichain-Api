/**
 * E2E — le verrou de détection ne doit pas fuiter (chaîne du froid).
 *
 * `checkAndAlert` sérialise les détections concurrentes d'un même matériel par un verrou
 * consultatif Postgres. Un verrou consultatif de SESSION appartient à la connexion qui l'a pris :
 * pris et relâché par deux requêtes Prisma distinctes, le relâchement peut partir sur une AUTRE
 * connexion du pool. Le verrou reste alors détenu pour la durée de vie de la connexion, et toute
 * détection ultérieure sur ce matériel échoue à le prendre → elle sort sans rien détecter.
 * La surveillance du froid s'éteint en silence, sans erreur ni trace.
 *
 * Ce scénario provoque la concurrence qui révèle le défaut, puis vérifie les deux conséquences :
 * une seule alerte créée (dédup), et AUCUN verrou encore détenu à la fin.
 *
 * Lancement : npm run e2e:iot-advisory-lock
 */
import { createHash } from 'crypto';
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

const CONCURRENT_PINGS = 8;
const PINGS_IN_WINDOW = 6;
const THRESHOLD = 4;
const OVER_THRESHOLD_TEMP = 8;

const failures: string[] = [];
function assert(condition: boolean, label: string) {
  if (!condition) {
    failures.push(label);
    console.error(`  ❌ ${label}`);
  } else {
    console.log(`  ✅ ${label}`);
  }
}

/** Même dérivation que `advisoryLockKey` du service : les 60 bits de poids faible du SHA-256. */
function advisoryLockParts(orgId: string, equipmentId: string) {
  const digest = createHash('sha256').update(`${orgId}:${equipmentId}`).digest();
  const high = BigInt(digest.readUInt32BE(0)) & 0x7fffffffn;
  const low = BigInt(digest.readUInt32BE(4));
  return { high, low };
}

/**
 * `pg_locks` éclate une clé BIGINT en deux entiers 32 bits : `classid` porte les bits hauts,
 * `objid` les bits bas. On compte les verrous encore détenus pour CE matériel uniquement.
 */
async function heldLocksFor(orgId: string, equipmentId: string): Promise<number> {
  const { high, low } = advisoryLockParts(orgId, equipmentId);
  const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*)::bigint AS count FROM pg_locks
      WHERE locktype = 'advisory' AND classid = ${high} AND objid = ${low}`
  );
  return Number(rows[0].count);
}

async function main() {
  console.log(`[E2E] Verrou de détection IoT — org ${ORG_ID}`);
  await connectMongoDB();

  const stamp = Date.now();
  const sensorId = `E2E-LOCK-SENSOR-${stamp}`;
  let equipmentId: string | null = null;

  try {
    let location = await prisma.location.findFirst({ where: { organization_id: ORG_ID! } });
    if (!location) {
      location = await prisma.location.create({
        data: { organization_id: ORG_ID!, nom: `E2E-Lock-Loc-${stamp}`, type: 'WAREHOUSE' },
      });
    }

    const equipment = await prisma.equipment.create({
      data: {
        organization_id: ORG_ID!,
        nom: `E2E-Lock-Frigo-${stamp}`,
        type: 'FRIGO',
        id_lieu: location.id,
        sensor_id: sensorId,
        temp_seuil_max: THRESHOLD,
        qr_code_id: `QR-${sensorId}`,
      },
    });
    equipmentId = equipment.id;
    _clearThresholdCacheForTests();

    // Fenêtre d'excursion complète AVANT toute détection : la détection exige au moins 5 points
    // dont 80 % au-dessus du seuil. On écrit d'abord, on détecte ensuite.
    for (let i = PINGS_IN_WINDOW - 1; i >= 0; i--) {
      await TelemetryModel.create({
        metadata: { sensor_id: sensorId, organization_id: ORG_ID! },
        timestamp: new Date(Date.now() - i * 60_000),
        temperature: OVER_THRESHOLD_TEMP,
        humidity: 50,
        battery_level: 80,
      });
    }

    // On attend sur la requête EXACTE que la détection utilise (capteur + organisation + fenêtre) :
    // attendre sur un autre prédicat ne prouve rien de ce que la détection, elle, verra.
    const since = new Date(Date.now() - 15 * 60_000);
    let visible = 0;
    for (let i = 0; i < 40; i++) {
      visible = await TelemetryModel.countDocuments({
        'metadata.sensor_id': sensorId,
        'metadata.organization_id': ORG_ID!,
        timestamp: { $gte: since },
      });
      if (visible >= PINGS_IN_WINDOW) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (visible < PINGS_IN_WINDOW) {
      throw new Error(
        `Les points écrits ne sont pas relisibles (${visible}/${PINGS_IN_WINDOW}) : la détection ne peut rien voir.`
      );
    }

    console.log(`\nScénario — ${CONCURRENT_PINGS} détections concurrentes sur le même matériel`);
    await Promise.all(
      Array.from({ length: CONCURRENT_PINGS }, () =>
        iotAlertService.checkAndAlert({
          sensorId,
          organizationId: ORG_ID!,
          currentTemp: OVER_THRESHOLD_TEMP,
          timestamp: new Date(),
        })
      )
    );

    const alerts = await prisma.alert.count({
      where: { id_materiel: equipment.id, type: 'TEMP_EXCURSION', statut: 'ACTIVE' },
    });
    assert(alerts === 1, `1 seule Alert ACTIVE malgré la concurrence (reçu ${alerts})`);

    const held = await heldLocksFor(ORG_ID!, equipment.id);
    assert(held === 0, `aucun verrou consultatif encore détenu (reçu ${held})`);

    // La conséquence réelle du verrou fuité : la détection SUIVANTE ne détecte plus rien.
    console.log('\nScénario — une détection ultérieure reste possible');
    await prisma.alert.deleteMany({ where: { id_materiel: equipment.id } });
    await iotAlertService.checkAndAlert({
      sensorId,
      organizationId: ORG_ID!,
      currentTemp: OVER_THRESHOLD_TEMP,
      timestamp: new Date(),
    });
    const alertsAfter = await prisma.alert.count({
      where: { id_materiel: equipment.id, type: 'TEMP_EXCURSION', statut: 'ACTIVE' },
    });
    assert(alertsAfter === 1, `l excursion est de nouveau détectée après coup (reçu ${alertsAfter})`);
  } catch (err) {
    console.error('\n[E2E] Erreur fatale:', err);
    failures.push(`Exception: ${(err as Error).message}`);
  } finally {
    console.log('\n[E2E] Cleanup...');
    if (equipmentId) {
      // On ne supprime PAS les lignes Audit_Log : la chaîne WORM est chaînée par hash.
      await prisma.alert.deleteMany({ where: { id_materiel: equipmentId } });
      await prisma.equipment.delete({ where: { id: equipmentId } }).catch(() => undefined);
    }
    await TelemetryModel.deleteMany({ 'metadata.sensor_id': sensorId });
    console.log('  → fixtures supprimées');
    await prisma.$disconnect();
    await disconnectMongoDB();
    if (failures.length > 0) {
      console.error(`\n❌ ${failures.length} échec(s):`);
      failures.forEach((f) => console.error(`   - ${f}`));
      process.exitCode = 1;
    } else {
      console.log('\n✅ Le verrou de détection ne fuite pas.');
    }
  }
}

main();
