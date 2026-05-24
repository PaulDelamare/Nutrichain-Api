import { describe, it, expect, beforeEach, vi } from 'vitest';
import { shipmentService } from './shipment.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    $transaction: vi.fn((callback) => callback(prisma)),
    batch: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    liaison_Shipment: {
      create: vi.fn(),
    },
    batch_Mouvement: {
      create: vi.fn(),
    },
    shipment: {
      create: vi.fn(),
      count: vi.fn().mockResolvedValue(10), // On simule 10 expéditions existantes
    },
  },
}));

describe('ShipmentService', () => {
  const mockShipmentData = {
    organization_id: 'org-123',
    id_client: 'client-456',
    shipment_id: 'SHIP-001',
    transporteur: 'DHL',
    date_envoi: new Date(),
    created_by: 'user-789',
    items: [{ id_lot: 'batch-1', quantite: 10 }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('devrait créer une expédition avec succès', async () => {
    const mockBatch = {
      id: 'batch-1',
      organization_id: 'org-123',
      quantite_actuelle: { toNumber: () => 100 },
      unite_code: 'KG',
      statut: 'EN_STOCK',
      date_peremption: new Date(Date.now() + 1000000),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(mockBatch as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.shipment.create).mockResolvedValue({ id: 'ship-1' } as any);

    const result = await shipmentService.createShipment(mockShipmentData);

    expect(prisma.shipment.create).toHaveBeenCalled();
    expect(prisma.batch.update).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: expect.objectContaining({
        quantite_actuelle: { decrement: 10 },
      }),
    });
    expect(prisma.liaison_Shipment.create).toHaveBeenCalled();
    expect(prisma.batch_Mouvement.create).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('devrait générer un SSCC automatiquement si shipment_id est AUTO', async () => {
    const mockBatch = {
      id: 'batch-1',
      organization_id: 'org-123',
      quantite_actuelle: { toNumber: () => 100 },
      unite_code: 'KG',
      statut: 'EN_STOCK',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(mockBatch as any);
    vi.mocked(prisma.shipment.create).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (args: any) => ({ ...args.data, id: 'ship-new' }) as any
    );

    const result = await shipmentService.createShipment({
      ...mockShipmentData,
      shipment_id: 'AUTO',
    });

    // 10 existants + 1 = 11. Le SSCC doit finir par le check digit.
    expect(result.shipment_id).toHaveLength(18);
    expect(result.shipment_id.startsWith('03456789')).toBe(true);
    expect(prisma.shipment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shipment_id: expect.stringMatching(/^[0-9]{18}$/),
        }),
      })
    );
  });

  it('devrait échouer si le lot est introuvable', async () => {
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(null);

    await expect(shipmentService.createShipment(mockShipmentData)).rejects.toThrow(
      new APIError(404, {
        error: [{ field: 'lots', message: 'Lot batch-1 introuvable ou accès refusé.' }],
      })
    );
  });

  it('devrait échouer si le stock est insuffisant', async () => {
    const mockBatch = {
      id: 'batch-1',
      organization_id: 'org-123',
      quantite_actuelle: { toNumber: () => 5 },
      unite_code: 'KG',
      statut: 'EN_STOCK',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(mockBatch as any);

    await expect(shipmentService.createShipment(mockShipmentData)).rejects.toThrow(
      new APIError(400, {
        error: [{ field: 'lots', message: 'Stock insuffisant pour le lot batch-1.' }],
      })
    );
  });

  it('devrait échouer si le lot est NON_CONFORME', async () => {
    const mockBatch = {
      id: 'batch-1',
      organization_id: 'org-123',
      quantite_actuelle: { toNumber: () => 100 },
      unite_code: 'KG',
      statut: 'NON_CONFORME',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(mockBatch as any);

    await expect(shipmentService.createShipment(mockShipmentData)).rejects.toThrow(
      new APIError(400, {
        error: [
          {
            field: 'lots',
            message: 'Le lot batch-1 est marqué NON_CONFORME et ne peut être expédié.',
          },
        ],
      })
    );
  });

  it('devrait échouer si le lot est périmé', async () => {
    const mockBatch = {
      id: 'batch-1',
      organization_id: 'org-123',
      quantite_actuelle: { toNumber: () => 100 },
      unite_code: 'KG',
      statut: 'EN_STOCK',
      date_peremption: new Date(Date.now() - 1000000),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(mockBatch as any);

    await expect(shipmentService.createShipment(mockShipmentData)).rejects.toThrow(
      new APIError(400, {
        error: [{ field: 'lots', message: 'Le lot batch-1 est périmé.' }],
      })
    );
  });
});
