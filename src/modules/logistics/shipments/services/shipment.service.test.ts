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
      delete: vi.fn(),
    },
    logistic_Unit: {
      findFirst: vi.fn(),
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

/**
 * Étape 3 de #284 — l'expédition reprend la palette existante au lieu d'en fabriquer une.
 *
 * Charger une palette est le geste du quai : on pousse un contenant, on ne dicte pas une liste de
 * lots. Et c'est le seul cas où l'origine de la marchandise est CERTAINE — ce qui part est
 * exactement ce que la palette portait.
 */
describe('expédier une palette', () => {
  const PALETTE = {
    id: 'palette-1',
    sscc: '034567890000000606',
    contenu: [{ id_lot: 'batch-1', quantite: 30, unite: 'KG' }],
    liaisons: [],
  };

  const lotSurPalette = {
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

  const bon = {
    organization_id: 'org-123',
    id_client: 'client-456',
    shipment_id: 'SHIP-PAL',
    transporteur: 'DHL',
    date_envoi: new Date(),
    created_by: 'user-789',
  };

  const expedierLaPalette = () =>
    shipmentService.createShipment({ ...bon, items: [], palettes: ['00034567890000000606'] });

  beforeEach(() => {
    // Ce bloc vit hors du `describe` parent : il ne bénéficie pas de sa remise à zéro, et sans
    // elle les appels s'accumulent d'un test à l'autre — un `not.toHaveBeenCalled` deviendrait
    // faux pour une raison qui n'a rien à voir avec le code testé.
    vi.clearAllMocks();
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({
      id: 'client-456',
      is_active: true,
    } as never);
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      gs1_company_prefix: '3456789',
    } as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ serial: 11n }] as never);
    vi.mocked(prisma.batch.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(PALETTE as never);
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(lotSurPalette as never);
    vi.mocked(prisma.shipment.create).mockResolvedValue({ id: 'ship-1' } as never);
  });

  it('développe le contenu de la palette en lignes d’expédition', async () => {
    await expedierLaPalette();

    // L'AI `00` que porte l'étiquette est retiré avant la résolution.
    expect(prisma.logistic_Unit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sscc: '034567890000000606', organization_id: 'org-123' },
      })
    );
    expect(prisma.batch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ quantite_actuelle: { decrement: 30 } }),
      })
    );
  });

  it('inscrit la palette sur la liaison — un rappel doit savoir quel contenant retirer', async () => {
    await expedierLaPalette();

    expect(prisma.liaison_Shipment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id_unite_logistique: 'palette-1' }),
    });
  });

  /**
   * #297 : à l'expédition d'une palette, et à ce moment SEULEMENT, l'origine est certaine. La
   * ligne de contenu s'en va donc entièrement, au lieu d'être plafonnée au stock restant du lot —
   * sinon la même palette resterait chargeable en boucle.
   */
  it('retire le contenu de la palette, sans plafonner sur le stock restant', async () => {
    await expedierLaPalette();

    expect(prisma.logistic_Unit_Content.delete).toHaveBeenCalledWith({
      where: {
        id_unite_logistique_id_lot: { id_unite_logistique: 'palette-1', id_lot: 'batch-1' },
      },
    });
    expect(prisma.logistic_Unit_Content.updateMany).not.toHaveBeenCalled();
  });

  it('nomme les palettes dans le maillon d’audit', async () => {
    await expedierLaPalette();

    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        newValue: expect.objectContaining({ palettes: ['034567890000000606'] }),
      }),
      expect.anything()
    );
  });

  it('refuse (409) une palette déjà partie sur une expédition', async () => {
    vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue({
      ...PALETTE,
      liaisons: [{ id: 'liaison-1' }],
    } as never);

    await expect(expedierLaPalette()).rejects.toMatchObject({ status: 409 });
    expect(prisma.batch.updateMany).not.toHaveBeenCalled();
  });

  // Le contenu d'une palette ouverte est toujours vide : sans une garde propre, ce cas tomberait
  // sur « ne porte aucun lot », un diagnostic vrai mais qui enverrait l'opérateur la remplir.
  it('refuse (409) une palette ouverte, et pas pour cause de contenu vide', async () => {
    vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue({
      ...PALETTE,
      opened_at: new Date('2026-07-31T08:00:00Z'),
      contenu: [],
    } as never);

    const erreur = await expedierLaPalette().catch((e) => e);
    expect(erreur).toMatchObject({ status: 409 });
    expect(JSON.stringify(erreur.data ?? erreur)).toContain('ouverte');
    expect(prisma.batch.updateMany).not.toHaveBeenCalled();
  });

  it('refuse (409) une palette qui ne porte plus rien', async () => {
    vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue({
      ...PALETTE,
      contenu: [],
    } as never);

    await expect(expedierLaPalette()).rejects.toMatchObject({ status: 409 });
  });

  it('refuse (404) la palette d’une autre organisation', async () => {
    vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(null);

    await expect(expedierLaPalette()).rejects.toMatchObject({ status: 404 });
  });

  it('refuse (400) le même lot chargé en vrac ET sur une palette', async () => {
    const action = shipmentService.createShipment({
      ...bon,
      items: [{ id_lot: 'batch-1', quantite: 5 }],
      palettes: ['034567890000000606'],
    });

    await expect(action).rejects.toMatchObject({ status: 400 });
    expect(prisma.batch.updateMany).not.toHaveBeenCalled();
  });

  it('refuse (400) deux fois la même palette sur le même bon', async () => {
    const action = shipmentService.createShipment({
      ...bon,
      items: [],
      palettes: ['034567890000000606', '00034567890000000606'],
    });

    // Le message est assorti : sans lui, la garde « lot déjà chargé » attrape le même cas avec le
    // même statut, et retirer la garde de doublon de palette laissait ce test vert.
    await expect(action).rejects.toMatchObject({
      status: 400,
      body: { error: [{ field: 'palettes', message: expect.stringContaining('figure deux fois') }] },
    });
  });

  it('refuse (400) le même lot deux fois en vrac, au lieu de le déduire deux fois', async () => {
    const action = shipmentService.createShipment({
      ...bon,
      items: [
        { id_lot: 'batch-1', quantite: 5 },
        { id_lot: 'batch-1', quantite: 5 },
      ],
    });

    await expect(action).rejects.toMatchObject({
      status: 400,
      body: { error: [{ field: 'lots', message: expect.stringContaining('figure deux fois') }] },
    });
    expect(prisma.batch.updateMany).not.toHaveBeenCalled();
  });

  /**
   * La borne de `lots` (500) ne bornait plus la transaction : 50 palettes de 100 lots la font
   * gonfler à 5 000 lignes, bien au-delà du timeout Prisma de 5 s. Le plafond porte donc sur le
   * total développé.
   */
  it('refuse (400) une expédition dont les palettes développent trop de lignes', async () => {
    vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue({
      ...PALETTE,
      contenu: Array.from({ length: 501 }, (_, i) => ({
        id_lot: `batch-${i}`,
        quantite: 1,
        unite: 'KG',
      })),
    } as never);

    await expect(expedierLaPalette()).rejects.toMatchObject({
      status: 400,
      body: { error: [{ field: 'palettes' }] },
    });
    expect(prisma.batch.updateMany).not.toHaveBeenCalled();
  });

  /**
   * Un opérateur qui pousse une palette n'a saisi aucun `lots` et ne voit jamais d'UUID : lui
   * opposer les deux rend le refus inexploitable — ni surlignable, ni traduisible côté client.
   */
  it('désigne le lot par son numéro et sa palette quand le refus vient d’une palette', async () => {
    vi.mocked(prisma.batch.findFirst).mockResolvedValue({
      ...lotSurPalette,
      statut: 'ALERTE',
    } as never);

    await expect(expedierLaPalette()).rejects.toMatchObject({
      status: 400,
      body: {
        error: [
          {
            field: 'palettes',
            message: expect.stringContaining('260704-LOT001 (palette 034567890000000606)'),
          },
        ],
      },
    });
  });

  /**
   * Sans cet événement, deux contenants GS1 revendiquent la même marchandise pour toujours : la
   * palette l'a agrégée à la palettisation et rien ne l'en retire jamais.
   */
  it('désagrège la palette (AggregationEvent DELETE) avant d’agréger l’expédition', async () => {
    await expedierLaPalette();

    expect(prisma.ePCIS_Event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_type: 'AggregationEvent',
        related_entity: 'Logistic_Unit',
        related_id: 'palette-1',
        payload: expect.objectContaining({
          action: 'DELETE',
          bizStep: 'urn:epcglobal:cbv:bizstep:unpacking',
          // Exactement l URN que la palettisation a agrege (meme `buildSsccUrn`, meme prefixe) :
          // un DELETE qui nommerait un autre contenant ne refermerait rien.
          parentID: 'urn:epc:id:sscc:3456789.0000000060',
        }),
      }),
    });
  });

  it('refuse (400) une expédition sans lot ni palette, avant toute lecture', async () => {
    const action = shipmentService.createShipment({ ...bon, shipment_id: 'SHIP-VIDE', items: [] });

    await expect(action).rejects.toMatchObject({ status: 400 });
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
  });
});
