import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import mongoose from 'mongoose';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { connectMongoDB, disconnectMongoDB } from '../../../shared/configs/mongoClient.config';
import { TelemetryModel } from '../models/telemetry.model';
import { iotAlertService, _clearThresholdCacheForTests } from './iotAlert.service';

/** Même dérivation que `advisoryLockKey` (privée) du service : les 60 bits de poids faible du SHA-256. */
function advisoryLockParts(orgId: string, equipmentId: string) {
  const digest = createHash('sha256').update(`${orgId}:${equipmentId}`).digest();
  const high = BigInt(digest.readUInt32BE(0)) & 0x7fffffffn;
  const low = BigInt(digest.readUInt32BE(4));
  return { high, low };
}

/**
 * `pg_try_advisory_xact_lock` n'existe que dans PostgreSQL : un mock ne peut ni le poser, ni
 * prouver qu'il se relâche vraiment à la fin de la transaction — c'est exactement ce qu'un
 * verrou consultatif de SESSION (pris et relâché par deux requêtes Prisma distinctes sur des
 * connexions différentes du pool) laisserait fuiter en silence (#150).
 */
describe('verrou consultatif de détection IoT (PostgreSQL réel)', () => {
  const ORG_ID = `it-lock-${Date.now()}`;
  const sensorId = `IT-LOCK-SENSOR-${Date.now()}`;
  const CONCURRENT_PINGS = 8;
  const PINGS_IN_WINDOW = 6;
  const THRESHOLD = 4;
  const OVER_THRESHOLD_TEMP = 8;
  let equipmentId: string;

  beforeAll(async () => {
    await connectMongoDB();
  });

  const heldLocksFor = async (orgId: string, equipId: string): Promise<number> => {
    const { high, low } = advisoryLockParts(orgId, equipId);
    const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM pg_locks
        WHERE locktype = 'advisory' AND classid = ${high} AND objid = ${low}`
    );
    return Number(rows[0].count);
  };

  afterAll(async () => {
    if (equipmentId) {
      await prisma.alert.deleteMany({ where: { id_materiel: equipmentId } });
      await prisma.equipment.deleteMany({ where: { id: equipmentId } });
    }
    await TelemetryModel.deleteMany({ 'metadata.sensor_id': sensorId });
    // Audit_Log.organization est onDelete Restrict (chaîne WORM, cf. le test dédié) : purger avant
    // l'organisation, comme partout ailleurs où ce cloisonnement est prouvé.
    await prisma.audit_Log.deleteMany({ where: { organization_id: ORG_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await disconnectMongoDB();
  });

  it("une seule Alert survit à N détections concurrentes sur le même matériel, et le verrou ne fuite pas", async () => {
    await prisma.organization.create({
      data: { id: ORG_ID, name: 'IT Lock', slug: ORG_ID, createdAt: new Date(), metadata: '{}' },
    });
    const location = await prisma.location.create({
      data: { organization_id: ORG_ID, nom: `IT-Lock-Loc-${Date.now()}`, type: 'WAREHOUSE' },
    });
    const equipment = await prisma.equipment.create({
      data: {
        organization_id: ORG_ID,
        nom: `IT-Lock-Frigo-${Date.now()}`,
        type: 'FRIGO',
        id_lieu: location.id,
        sensor_id: sensorId,
        temp_seuil_max: THRESHOLD,
        qr_code_id: `QR-${sensorId}`,
      },
    });
    equipmentId = equipment.id;
    _clearThresholdCacheForTests();

    // Fenêtre d'excursion complète AVANT toute détection, dans une session à cohérence causale
    // (même mécanisme qu'en production, cf. #227) : la détection exige au moins 5 points dont
    // 80 % au-dessus du seuil.
    const session = await mongoose.startSession();
    try {
      const points = Array.from({ length: PINGS_IN_WINDOW }, (_, idx) => {
        const i = PINGS_IN_WINDOW - 1 - idx;
        return {
          metadata: { sensor_id: sensorId, organization_id: ORG_ID },
          timestamp: new Date(Date.now() - i * 60_000),
          temperature: OVER_THRESHOLD_TEMP,
          humidity: 50,
          battery_level: 80,
        };
      });
      await TelemetryModel.insertMany(points, { session });

      await Promise.all(
        Array.from({ length: CONCURRENT_PINGS }, () =>
          iotAlertService.checkAndAlert({
            sensorId,
            organizationId: ORG_ID,
            currentTemp: OVER_THRESHOLD_TEMP,
            timestamp: new Date(),
            mongoSession: session,
          })
        )
      );
    } finally {
      await session.endSession();
    }

    const alerts = await prisma.alert.count({
      where: { id_materiel: equipment.id, type: 'TEMP_EXCURSION', statut: 'ACTIVE' },
    });
    expect(alerts).toBe(1);

    const held = await heldLocksFor(ORG_ID, equipment.id);
    expect(held).toBe(0);

    // La conséquence réelle du verrou fuité : la détection SUIVANTE ne détecte plus rien.
    await prisma.alert.deleteMany({ where: { id_materiel: equipment.id } });
    await iotAlertService.checkAndAlert({
      sensorId,
      organizationId: ORG_ID,
      currentTemp: OVER_THRESHOLD_TEMP,
      timestamp: new Date(),
    });
    const alertsAfter = await prisma.alert.count({
      where: { id_materiel: equipment.id, type: 'TEMP_EXCURSION', statut: 'ACTIVE' },
    });
    expect(alertsAfter).toBe(1);
  }, 30_000);
});
