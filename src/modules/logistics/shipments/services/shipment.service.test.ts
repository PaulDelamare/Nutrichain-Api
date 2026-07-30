import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { shipmentService } from './shipment.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { auditService } from '../../../../shared/utils/audit/audit.service';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    $transaction: vi.fn((callback) => callback(prisma)),
    $queryRaw: vi.fn(),
    batch: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    liaison_Shipment: {
      create: vi.fn(),
    },
    batch_Mouvement: {
      create: vi.fn(),
    },
    logistic_Unit_Content: {
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
    shipment: {
      create: vi.fn(),
      count: vi.fn(),
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

vi.mock('../../../../shared/utils/audit/audit.service', () => ({
  auditService: { logAction: vi.fn() },
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

    vi.mocked(prisma.customer.findFirst).mockResolvedValue({
      id: 'client-456',
      is_active: true,
    } as never);
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      gs1_company_prefix: '3456789',
    } as never);
    // Le numéro de série d'un SSCC est RÉSERVÉ par la séquence Postgres, jamais compté (#124).
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ serial: 11n }] as never);
    // Par défaut, la déduction de stock gardée réussit (verrou optimiste : un seul lot mis à jour).
    vi.mocked(prisma.batch.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.logistic_Unit_Content.deleteMany).mockResolvedValue({ count: 0 } as never);
  });

  /**
   * Rien ne vidait jamais `Logistic_Unit_Content` : une palette continuait de déclarer une
   * marchandise partie chez le client, et devenait irrangeable — la garde de rangement exige que
   * tout son contenu soit déplaçable, ce qu'un lot expédié n'est plus.
   */
  describe('un lot qui quitte le stock quitte sa palette', () => {
    const lotDe100 = {
      id: 'batch-1',
      organization_id: 'org-123',
      lot_number: '260704-LOT001',
      produit: { code_gtin: '3456789012345' },
      unite_code: 'KG',
      statut: 'EN_STOCK',
      version: 7,
      date_peremption: new Date(Date.now() + 1000000),
    };

    beforeEach(() => {
      vi.mocked(prisma.shipment.create).mockResolvedValue({ id: 'ship-1' } as never);
    });

    it('détache le lot de ses palettes quand la totalité part', async () => {
      vi.mocked(prisma.batch.findFirst).mockResolvedValue({
        ...lotDe100,
        quantite_actuelle: new Prisma.Decimal(10),
      } as never);

      await shipmentService.createShipment(mockShipmentData);

      expect(prisma.logistic_Unit_Content.deleteMany).toHaveBeenCalledWith({
        where: {
          id_lot: 'batch-1',
          unite_logistique: { organization_id: 'org-123' },
        },
      });
    });

    it('sur une expédition partielle, plafonne ce que la palette déclare au stock restant', async () => {
      vi.mocked(prisma.batch.findFirst).mockResolvedValue({
        ...lotDe100,
        quantite_actuelle: new Prisma.Decimal(100),
      } as never);

      await shipmentService.createShipment(mockShipmentData);

      // Le lot garde 90 sur 100 : la palette reste, mais ne peut plus en déclarer davantage —
      // sinon `moveLogisticUnit` scellerait un mouvement portant une quantité qui n'existe plus.
      expect(prisma.logistic_Unit_Content.deleteMany).not.toHaveBeenCalled();
      expect(prisma.logistic_Unit_Content.updateMany).toHaveBeenCalledWith({
        where: {
          id_lot: 'batch-1',
          unite_logistique: { organization_id: 'org-123' },
          quantite: { gt: 90 },
        },
        data: { quantite: 90 },
      });
    });
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
      quantite_actuelle: new Prisma.Decimal(100),
      unite_code: 'KG',
      statut: 'EN_STOCK',
      version: 7,
      date_peremption: new Date(Date.now() + 1000000),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(mockBatch as any);

    vi.mocked(prisma.shipment.create).mockResolvedValue({ id: 'ship-1' } as never);

    const result = await shipmentService.createShipment(mockShipmentData);

    // L'adresse de destination fournie est bien persistée (et non plus jetée).
    expect(prisma.shipment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ destination_adresse: '12 rue de la Livraison, Paris' }),
    });
    // Déduction gardée : where sur (id, org, version lue, statut non bloquant) + version incrémentée.
    expect(prisma.batch.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'batch-1',
        organization_id: 'org-123',
        version: 7,
      }),
      data: expect.objectContaining({
        quantite_actuelle: { decrement: 10 },
        version: { increment: 1 },
      }),
    });
    expect(prisma.liaison_Shipment.create).toHaveBeenCalled();
    expect(prisma.batch_Mouvement.create).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('scelle l’expédition dans la chaîne d’audit WORM (CREATE_SHIPMENT, dans la tx)', async () => {
    const mockBatch = {
      id: 'batch-1',
      organization_id: 'org-123',
      lot_number: '260704-LOT001',
      produit: { code_gtin: '3456789012345' },
      quantite_actuelle: new Prisma.Decimal(100),
      unite_code: 'KG',
      statut: 'EN_STOCK',
      version: 1,
      date_peremption: new Date(Date.now() + 1000000),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(mockBatch as any);
    vi.mocked(prisma.shipment.create).mockResolvedValue({ id: 'ship-1' } as never);

    await shipmentService.createShipment(mockShipmentData);

    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE_SHIPMENT',
        entity: 'Shipment',
        entityId: 'ship-1',
        newValue: expect.objectContaining({ id_client: 'client-456' }),
      }),
      expect.anything() // la tx : audit scellé dans la même transaction que l'expédition
    );
  });

  it('devrait émettre un ObjectEvent EPCIS avec URN LGTIN lors de l expédition', async () => {
    const mockBatch = {
      id: 'batch-1',
      organization_id: 'org-123',
      lot_number: '260704-LOT001',
      produit: { code_gtin: '3456789012345' },
      quantite_actuelle: new Prisma.Decimal(100),
      unite_code: 'KG',
      statut: 'EN_STOCK',
      date_peremption: new Date(Date.now() + 1000000),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(mockBatch as any);

    vi.mocked(prisma.shipment.create).mockResolvedValue({ id: 'ship-1' } as never);

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
      quantite_actuelle: new Prisma.Decimal(100),
      unite_code: 'KG',
      statut: 'EN_STOCK',
      date_peremption: new Date(Date.now() + 1000000),
    });

    vi.mocked(prisma.batch.findFirst)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValueOnce(makeBatch('batch-1', '260704-LOT001') as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValueOnce(makeBatch('batch-2', '260704-LOT002') as any);

    vi.mocked(prisma.shipment.create).mockResolvedValue({ id: 'ship-1' } as never);

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
      quantite_actuelle: new Prisma.Decimal(100),
      unite_code: 'KG',
      statut: 'EN_STOCK',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(mockBatch as any);

    vi.mocked(prisma.shipment.create).mockResolvedValue({ id: 'ship-1' } as never);

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
      quantite_actuelle: new Prisma.Decimal(100),
      unite_code: 'KG',
      statut: 'EN_STOCK',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(mockBatch as any);

    vi.mocked(prisma.shipment.create).mockResolvedValue({ id: 'ship-1' } as never);

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
      quantite_actuelle: new Prisma.Decimal(100),
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

    // Le serial 11 vient de la séquence, pas d'un comptage. Le SSCC finit par son check digit.
    expect(result.shipment_id).toHaveLength(18);
    expect(result.shipment_id.startsWith('03456789000000011')).toBe(true);
    expect(prisma.shipment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shipment_id: expect.stringMatching(/^[0-9]{18}$/),
        }),
      })
    );
  });

  it('réserve le numéro de série au lieu de le compter (deux expéditions ne peuvent pas collisionner)', async () => {
    // Le cœur de #124 : `count()` est une LECTURE — deux expéditions simultanées lisaient la même
    // valeur et fabriquaient le MÊME SSCC ; la seconde mourait sur un P2002 en 500.
    const mockBatch = {
      id: 'batch-1',
      organization_id: 'org-123',
      lot_number: '260704-LOT001',
      produit: { code_gtin: '3456789012345' },
      quantite_actuelle: new Prisma.Decimal(100),
      unite_code: 'KG',
      statut: 'EN_STOCK',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(mockBatch as any);
    vi.mocked(prisma.shipment.create).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (args: any) => ({ ...args.data, id: 'ship-new' }) as any
    );
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ serial: 11n }] as never)
      .mockResolvedValueOnce([{ serial: 12n }] as never);

    const premiere = await shipmentService.createShipment({
      ...mockShipmentData,
      shipment_id: 'AUTO',
    });
    const seconde = await shipmentService.createShipment({
      ...mockShipmentData,
      shipment_id: 'AUTO',
    });

    expect(premiere.shipment_id).not.toBe(seconde.shipment_id);
    expect(prisma.shipment.count).not.toHaveBeenCalled();
  });

  it("traduit le doublon d'identifiant en 409 au lieu d'un 500 illisible", async () => {
    const mockBatch = {
      id: 'batch-1',
      organization_id: 'org-123',
      quantite_actuelle: new Prisma.Decimal(100),
      unite_code: 'KG',
      statut: 'EN_STOCK',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(mockBatch as any);
    vi.mocked(prisma.shipment.create).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      })
    );

    await expect(shipmentService.createShipment(mockShipmentData)).rejects.toMatchObject({
      status: 409,
    });
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
      quantite_actuelle: new Prisma.Decimal(5),
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
        quantite_actuelle: new Prisma.Decimal(100),
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

  it('REFUSE (409) si le lot a changé d’état entre la lecture et l’écriture (rappel concurrent)', async () => {
    // Le cœur du correctif #92 : la garde `isBatchBlocked` est passée sur une lecture EN_STOCK, mais
    // un rappel commit entre-temps. Le verrou optimiste (version + statut) fait `count === 0` → 409,
    // au lieu d'écraser le rappel et de laisser la marchandise partir chez le client.
    const mockBatch = {
      id: 'batch-1',
      organization_id: 'org-123',
      lot_number: '260704-LOT001',
      produit: { code_gtin: '3456789012345' },
      quantite_actuelle: new Prisma.Decimal(100),
      unite_code: 'KG',
      statut: 'EN_STOCK',
      version: 3,
      date_peremption: new Date(Date.now() + 1000000),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(mockBatch as any);
    vi.mocked(prisma.shipment.create).mockResolvedValue({ id: 'ship-1' } as never);
    // Aucune ligne mise à jour : l'état a bougé depuis la lecture.
    vi.mocked(prisma.batch.updateMany).mockResolvedValue({ count: 0 } as never);

    await expect(shipmentService.createShipment(mockShipmentData)).rejects.toMatchObject({
      status: 409,
      body: { error: [{ field: 'lots' }] },
    });
    // La liaison et le mouvement ne sont jamais créés : rien ne part.
    expect(prisma.liaison_Shipment.create).not.toHaveBeenCalled();
  });

  it('devrait échouer si le lot est périmé', async () => {
    const mockBatch = {
      id: 'batch-1',
      organization_id: 'org-123',
      quantite_actuelle: new Prisma.Decimal(100),
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
