import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { connectMongoDB, disconnectMongoDB } from '../../../shared/configs/mongoClient.config';
import { TelemetryModel } from '../models/telemetry.model';
import { _clearThresholdCacheForTests } from './iotAlert.service';
import { coldChainSimulationService } from './coldChainSimulation.service';
import { APIError } from '../../../shared/utils/errorHandler/APIError';

/**
 * Le bouton « Simuler un incident » de la page chaine du froid doit produire un VRAI incident :
 * pas une reponse cosmetique, mais l'alerte + la quarantaine que le pipeline IoT reel cree. On le
 * prouve contre un vrai PostgreSQL + Mongo — un Prisma/Mongo mockes ne prouveraient rien de l'effet.
 */
describe('coldChainSimulationService — simule un incident froid reel (PostgreSQL + Mongo reels)', () => {
  const marque = Date.now();
  const ORG_ID = `sim-froid-${marque}`;
  const SENSOR_ID = `SIM-FROID-SENSOR-${marque}`;
  const SEUIL = 4;

  let equipmentId: string;
  let sansSeuilId: string;
  let userId: string;
  let productId: string;

  beforeAll(async () => {
    await connectMongoDB();

    await prisma.organization.create({
      data: { id: ORG_ID, name: 'Sim froid', slug: ORG_ID, createdAt: new Date(), metadata: '{}' },
    });
    const user = await prisma.user.create({
      data: {
        id: `sim-froid-user-${marque}`,
        name: 'Operateur Sim',
        email: `sim-froid-${marque}@nutrichain.test`,
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
        nom: 'Beurre Sim',
        code_gtin: `SIM${marque}`.slice(0, 14),
        categorie: 'PRODUIT_FINI',
        duree_conservation_defaut: 30,
        seuil_alerte_stock: 10,
        unite_reference: 'KG',
      },
    });
    productId = product.id;

    const location = await prisma.location.create({
      data: { organization_id: ORG_ID, nom: `Sim-Loc-${marque}`, type: 'COLD_STORAGE' },
    });
    const fridge = await prisma.equipment.create({
      data: {
        organization_id: ORG_ID,
        nom: `Sim-Frigo-${marque}`,
        type: 'FRIGO',
        id_lieu: location.id,
        sensor_id: SENSOR_ID,
        temp_seuil_max: SEUIL,
        qr_code_id: `SIM-QR-${marque}`,
      },
    });
    equipmentId = fridge.id;

    // Un materiel SANS seuil : la simulation doit le refuser (rien a detecter).
    const sansSeuil = await prisma.equipment.create({
      data: {
        organization_id: ORG_ID,
        nom: `Sim-SansSeuil-${marque}`,
        type: 'FRIGO',
        id_lieu: location.id,
        sensor_id: `SIM-SANS-SEUIL-${marque}`,
        temp_seuil_max: null,
        qr_code_id: `SIM-QR2-${marque}`,
      },
    });
    sansSeuilId = sansSeuil.id;

    // Un lot EN_STOCK range dans le frigo : la simulation doit le mettre en quarantaine.
    await prisma.batch.create({
      data: {
        organization_id: ORG_ID,
        id_produit: productId,
        lot_number: `SIM-${marque}-A`,
        quantite_actuelle: 100,
        quantite_base: 100,
        unite_code: 'KG',
        statut: 'EN_STOCK',
        id_materiel_actuel: equipmentId,
        created_by: userId,
      },
    });

    _clearThresholdCacheForTests();
  });

  afterAll(async () => {
    await prisma.batch_Mouvement.deleteMany({ where: { lot: { organization_id: ORG_ID } } });
    await prisma.batch.deleteMany({ where: { organization_id: ORG_ID } });
    await prisma.alert.deleteMany({ where: { organization_id: ORG_ID } });
    await prisma.equipment.deleteMany({ where: { organization_id: ORG_ID } });
    await prisma.location.deleteMany({ where: { organization_id: ORG_ID } });
    await prisma.product.deleteMany({ where: { organization_id: ORG_ID } });
    await TelemetryModel.deleteMany({ 'metadata.organization_id': ORG_ID });
    await prisma.audit_Log.deleteMany({ where: { organization_id: ORG_ID } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await disconnectMongoDB();
  });

  it('cree une vraie alerte PANIC et met les lots du frigo en quarantaine', async () => {
    const result = await coldChainSimulationService.simulateIncident({
      organizationId: ORG_ID,
      equipmentId,
    });

    expect(result.equipmentId).toBe(equipmentId);
    expect(result.alertCreated).toBe(true);
    expect(result.quarantinedCount).toBeGreaterThanOrEqual(1);

    const alerte = await prisma.alert.findFirst({
      where: { id_materiel: equipmentId, type: 'TEMP_EXCURSION', statut: 'ACTIVE' },
    });
    expect(alerte).not.toBeNull();
    expect(alerte?.niveau_gravite).toBe('PANIC');

    const lot = await prisma.batch.findFirstOrThrow({
      where: { organization_id: ORG_ID, lot_number: `SIM-${marque}-A` },
    });
    expect(lot.statut).toBe('BLOQUE');
  });

  it('refuse un materiel qui n’existe pas dans l’organisation (404)', async () => {
    await expect(
      coldChainSimulationService.simulateIncident({
        organizationId: ORG_ID,
        equipmentId: '00000000-0000-0000-0000-000000000000',
      })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuse un materiel sans seuil configure (409)', async () => {
    await expect(
      coldChainSimulationService.simulateIncident({ organizationId: ORG_ID, equipmentId: sansSeuilId })
    ).rejects.toBeInstanceOf(APIError);
    await expect(
      coldChainSimulationService.simulateIncident({ organizationId: ORG_ID, equipmentId: sansSeuilId })
    ).rejects.toMatchObject({ status: 409 });
  });
});
