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
    customer: {
      findFirst: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
    },
    ePCIS_Event: {
      create: vi.fn(),
    },
  },
}));

describe('ShipmentService', () => {
  const mockShipmentData = {
    organization_id: 'org-123',
    id_client: 'client-456',
    shipment_id: 'SHIP-001',
    transporteur: 'DHL',
    destination_adresse: '12 rue de la Livraison, Paris',
    date_envoi: new Date(),
    created_by: 'user-789',
    items: [{ id_lot: 'batch-1', quantite: 10 }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Par défaut, le client destinataire appartient bien à l'organisation (cas nominal).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({ id: 'client-456' } as any);
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      gs1_company_prefix: '3456789',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(prisma.shipment.count).mockResolvedValue(10);
  });

  it('devrait échouer (404) si le client destinataire n appartient pas à l organisation', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(null);

    await expect(shipmentService.createShipment(mockShipmentData)).rejects.toMatchObject({
      status: 404,
      body: { error: [{ field: 'id_client' }] },
    });
    // La garde tombe avant toute écriture.
    expect(prisma.shipment.create).not.toHaveBeenCalled();
  });

  it('devrait créer une expédition avec succès', async () => {
    const mockBatch = {
      id: 'batch-1',
      organization_id: 'org-123',
      lot_number: '260704-LOT001',
      produit: { code_gtin: '3456789012345' },
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

    // L'adresse de destination fournie est bien persistée (et non plus jetée).
    expect(prisma.shipment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ destination_adresse: '12 rue de la Livraison, Paris' }),
    });
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

  it('devrait émettre un ObjectEvent EPCIS avec URN LGTIN lors de l expédition', async () => {
    const mockBatch = {
      id: 'batch-1',
      organization_id: 'org-123',
      lot_number: '260704-LOT001',
      produit: { code_gtin: '3456789012345' },
      quantite_actuelle: { toNumber: () => 100 },
      unite_code: 'KG',
      statut: 'EN_STOCK',
      date_peremption: new Date(Date.now() + 1000000),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(mockBatch as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.shipment.create).mockResolvedValue({ id: 'ship-1' } as any);

    await shipmentService.createShipment(mockShipmentData);

    expect(prisma.ePCIS_Event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organization_id: 'org-123',
        event_type: 'ObjectEvent',
        related_entity: 'Shipment',
        related_id: 'ship-1',
        payload: expect.objectContaining({
          quantityList: [
            {
              epcClass: 'urn:epc:class:lgtin:3456789.001234.260704-LOT001',
              quantity: 10,
              uom: 'KG',
            },
          ],
          bizStep: 'urn:epcglobal:cbv:bizstep:shipping',
          destinationParty: 'client-456',
        }),
      }),
    });
  });

  it('expédition multi-lots : quantityList agrège tous les lots et le payload porte SSCC/disposition/action', async () => {
    const makeBatch = (id: string, lotNumber: string) => ({
      id,
      organization_id: 'org-123',
      lot_number: lotNumber,
      produit: { code_gtin: '3456789012345' },
      quantite_actuelle: { toNumber: () => 100 },
      unite_code: 'KG',
      statut: 'EN_STOCK',
      date_peremption: new Date(Date.now() + 1000000),
    });

    vi.mocked(prisma.batch.findFirst)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValueOnce(makeBatch('batch-1', '260704-LOT001') as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValueOnce(makeBatch('batch-2', '260704-LOT002') as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.shipment.create).mockResolvedValue({ id: 'ship-1' } as any);

    await shipmentService.createShipment({
      ...mockShipmentData,
      items: [
        { id_lot: 'batch-1', quantite: 10 },
        { id_lot: 'batch-2', quantite: 5 },
      ],
    });

    expect(prisma.ePCIS_Event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          quantityList: [
            expect.objectContaining({
              epcClass: 'urn:epc:class:lgtin:3456789.001234.260704-LOT001',
              quantity: 10,
            }),
            expect.objectContaining({
              epcClass: 'urn:epc:class:lgtin:3456789.001234.260704-LOT002',
              quantity: 5,
            }),
          ],
          action: 'OBSERVE',
          disposition: 'urn:epcglobal:cbv:disp:in_transit',
          sscc: 'SHIP-001',
        }),
      }),
    });
  });

  it("émet un AggregationEvent SSCC → lots quand l'identifiant est un SSCC généré", async () => {
    const mockBatch = {
      id: 'batch-1',
      organization_id: 'org-123',
      lot_number: '260704-LOT001',
      produit: { code_gtin: '3456789012345' },
      quantite_actuelle: { toNumber: () => 100 },
      unite_code: 'KG',
      statut: 'EN_STOCK',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(mockBatch as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.shipment.create).mockResolvedValue({ id: 'ship-1' } as any);

    await shipmentService.createShipment({ ...mockShipmentData, shipment_id: 'AUTO' });

    expect(prisma.ePCIS_Event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_type: 'AggregationEvent',
        related_entity: 'Shipment',
        related_id: 'ship-1',
        payload: expect.objectContaining({
          parentID: expect.stringMatching(/^urn:epc:id:sscc:3456789\.[0-9]{10}$/),
          childQuantityList: [
            expect.objectContaining({
              epcClass: 'urn:epc:class:lgtin:3456789.001234.260704-LOT001',
            }),
          ],
          action: 'ADD',
        }),
      }),
    });
  });

  it("l'AggregationEvent porte l'identifiant brut si l'expéditeur a fourni un id non-SSCC", async () => {
    const mockBatch = {
      id: 'batch-1',
      organization_id: 'org-123',
      lot_number: '260704-LOT001',
      produit: { code_gtin: '3456789012345' },
      quantite_actuelle: { toNumber: () => 100 },
      unite_code: 'KG',
      statut: 'EN_STOCK',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(mockBatch as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.shipment.create).mockResolvedValue({ id: 'ship-1' } as any);

    await shipmentService.createShipment(mockShipmentData); // shipment_id: 'SHIP-001'

    expect(prisma.ePCIS_Event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_type: 'AggregationEvent',
        payload: expect.objectContaining({ parentID: 'SHIP-001' }),
      }),
    });
  });

  it('cloisonne la recherche de lot par organisation (anti-fuite cross-tenant)', async () => {
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(null);

    await expect(shipmentService.createShipment(mockShipmentData)).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.batch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'batch-1', organization_id: 'org-123' } })
    );
  });

  it('devrait générer un SSCC automatiquement si shipment_id est AUTO', async () => {
    const mockBatch = {
      id: 'batch-1',
      organization_id: 'org-123',
      lot_number: '260704-LOT001',
      produit: { code_gtin: '3456789012345' },
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

  it.each(['BLOQUE', 'ALERTE'])(
    'devrait échouer si le lot est en statut bloquant %s (quarantaine / rappel)',
    async (statut) => {
      const mockBatch = {
        id: 'batch-1',
        organization_id: 'org-123',
        quantite_actuelle: { toNumber: () => 100 },
        unite_code: 'KG',
        statut,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.batch.findFirst).mockResolvedValue(mockBatch as any);

      await expect(shipmentService.createShipment(mockShipmentData)).rejects.toThrow(
        new APIError(400, {
          error: [
            {
              field: 'lots',
              message: `Le lot batch-1 est en statut ${statut} et ne peut être expédié.`,
            },
          ],
        })
      );
    }
  );

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
