import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { connectMongoDB, disconnectMongoDB } from '../../../shared/configs/mongoClient.config';
import { TelemetryModel } from '../models/telemetry.model';
import { iotAlertService, _clearThresholdCacheForTests } from './iotAlert.service';

/**
 * #266 — L'anti-spam de détection sortait de la transaction AVANT la mise en quarantaine des lots.
 *
 * Ce n'est pas qu'un défaut de test intermittent : c'est un TROU SANITAIRE. Tant qu'une alerte reste
 * ouverte sur un frigo en excursion — et elle reste ouverte jusqu'à ce qu'un humain la résolve — un
 * lot rangé dedans ENSUITE n'est plus jamais bloqué. Il reste EN_STOCK, donc expédiable, dans un
 * équipement dont on sait la chaîne du froid rompue.
 *
 * Contre un vrai PostgreSQL : c'est l'`UPDATE ... RETURNING` sous verrou de transaction qui est en
 * cause, et un Prisma mocké ne prouve rien de ce que la base fait réellement.
 */
describe('la quarantaine froid est rejouée tant que l’excursion dure (PostgreSQL + Mongo réels)', () => {
  const marque = Date.now();
  const ORG_ID = `it-266-${marque}`;
  const sensorId = `IT-266-SENSOR-${marque}`;
  const SEUIL = 4;
  const TEMP_EXCURSION = 8;
  const POINTS_FENETRE = 6; // la détection exige ≥ 5 points dont 80 % au-dessus du seuil

  let equipmentId: string;
  let userId: string;
  let productId: string;

  beforeAll(async () => {
    await connectMongoDB();

    await prisma.organization.create({
      data: { id: ORG_ID, name: 'IT 266', slug: ORG_ID, createdAt: new Date(), metadata: '{}' },
    });
    const user = await prisma.user.create({
      data: {
        id: `it-266-user-${marque}`,
        name: 'Opérateur IT',
        email: `it-266-${marque}@nutrichain.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    userId = user.id;

    await prisma.unit.upsert({
      where: { code: 'KG' },
      update: {},
      create: { code: 'KG', nom: 'Kilogrammes', factor_to_base: 1 },
    });

    const product = await prisma.product.create({
      data: {
        organization_id: ORG_ID,
        nom: 'Beurre IT',
        code_gtin: `IT266${marque}`.slice(0, 14),
        categorie: 'PRODUIT_FINI',
        duree_conservation_defaut: 30,
        seuil_alerte_stock: 10,
        unite_reference: 'KG',
      },
    });
    productId = product.id;

    const location = await prisma.location.create({
      data: { organization_id: ORG_ID, nom: `IT-266-Loc-${marque}`, type: 'COLD_STORAGE' },
    });
    const fridge = await prisma.equipment.create({
      data: {
        organization_id: ORG_ID,
        nom: `IT-266-Frigo-${marque}`,
        type: 'FRIGO',
        id_lieu: location.id,
        sensor_id: sensorId,
        temp_seuil_max: SEUIL,
        qr_code_id: `IT-266-QR-${marque}`,
      },
    });
    equipmentId = fridge.id;
  });

  afterAll(async () => {
    await prisma.batch_Mouvement.deleteMany({ where: { lot: { organization_id: ORG_ID } } });
    await prisma.batch.deleteMany({ where: { organization_id: ORG_ID } });
    await prisma.alert.deleteMany({ where: { organization_id: ORG_ID } });
    await prisma.equipment.deleteMany({ where: { organization_id: ORG_ID } });
    await prisma.location.deleteMany({ where: { organization_id: ORG_ID } });
    await prisma.product.deleteMany({ where: { organization_id: ORG_ID } });
    await TelemetryModel.deleteMany({ 'metadata.sensor_id': sensorId });
    // Audit_Log.organization est onDelete Restrict (chaîne WORM) : purger avant l'organisation.
    await prisma.audit_Log.deleteMany({ where: { organization_id: ORG_ID } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await disconnectMongoDB();
  });

  const rangerUnLotDansLeFrigo = (suffixe: string) =>
    prisma.batch.create({
      data: {
        organization_id: ORG_ID,
        id_produit: productId,
        lot_number: `IT-266-${marque}-${suffixe}`,
        quantite_actuelle: 100,
        quantite_base: 100,
        unite_code: 'KG',
        statut: 'EN_STOCK',
        id_materiel_actuel: equipmentId,
        created_by: userId,
      },
    });

  /** Une fenêtre d'excursion complète, écrite et relue dans la même session à cohérence causale. */
  const ingererUneExcursion = async () => {
    const maintenant = Date.now();
    const session = await mongoose.startSession();
    try {
      await TelemetryModel.insertMany(
        Array.from({ length: POINTS_FENETRE }, (_, idx) => ({
          metadata: { sensor_id: sensorId, organization_id: ORG_ID },
          timestamp: new Date(maintenant - (POINTS_FENETRE - 1 - idx) * 60_000),
          temperature: TEMP_EXCURSION,
          humidity: 50,
          battery_level: 80,
        })),
        { session }
      );
      _clearThresholdCacheForTests();
      await iotAlertService.checkAndAlert({
        sensorId,
        organizationId: ORG_ID,
        currentTemp: TEMP_EXCURSION,
        timestamp: new Date(maintenant),
        mongoSession: session,
      });
    } finally {
      await session.endSession();
    }
  };

  it('un lot rangé dans le frigo APRÈS l’ouverture de l’alerte est bloqué lui aussi (#266)', async () => {
    const premier = await rangerUnLotDansLeFrigo('AVANT');
    await ingererUneExcursion();

    expect((await prisma.batch.findUniqueOrThrow({ where: { id: premier.id } })).statut).toBe(
      'BLOQUE'
    );

    // L'exploitant n'a pas encore résolu l'alerte : le frigo est toujours en panne, et un opérateur
    // y range un nouveau lot. C'est le scénario que l'anti-spam laissait passer.
    const second = await rangerUnLotDansLeFrigo('APRES');
    await ingererUneExcursion();

    const secondApres = await prisma.batch.findUniqueOrThrow({ where: { id: second.id } });
    expect(secondApres.statut).toBe('BLOQUE');
    expect(secondApres.statut_avant_blocage).toBe('EN_STOCK');
  });

  it('l’anti-spam tient toujours : une seule alerte, un seul e-mail (#266)', async () => {
    const alertes = await prisma.alert.count({
      where: { id_materiel: equipmentId, type: 'TEMP_EXCURSION', statut: 'ACTIVE' },
    });

    expect(alertes).toBe(1);
  });

  it('le lot bloqué en second garde la trace de sa cause, rattachée à l’alerte ouverte (#266)', async () => {
    const alerte = await prisma.alert.findFirstOrThrow({
      where: { id_materiel: equipmentId, type: 'TEMP_EXCURSION', statut: 'ACTIVE' },
    });
    const lotApres = await prisma.batch.findFirstOrThrow({
      where: { organization_id: ORG_ID, lot_number: { endsWith: '-APRES' } },
    });
    const mouvement = await prisma.batch_Mouvement.findFirstOrThrow({
      where: { id_lot: lotApres.id, type_action: 'QUARANTAINE_FROID' },
    });

    expect((mouvement.metadata as { id_alerte?: string }).id_alerte).toBe(alerte.id);
  });
});
