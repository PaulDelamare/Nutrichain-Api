import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { receiptService } from './receipt.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { batchService } from '../../shared/services/batch.service';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    $transaction: vi.fn(async (arg) =>
      // Forme tableau (lectures type listReceipts) ⇒ Promise.all ; forme callback (écritures) ⇒
      // on passe le mock de prisma au callback.
      Array.isArray(arg) ? Promise.all(arg) : arg(prisma)
    ),
    $queryRaw: vi.fn().mockResolvedValue([]),
    supplier: { findFirst: vi.fn() },
    product: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    unit: { findUnique: vi.fn() },
    receipt: { create: vi.fn(), count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    batch: { findFirst: vi.fn() },
    audit_Log: { findFirst: vi.fn(), create: vi.fn() },
    ePCIS_Event: { create: vi.fn() },
    batch_Mouvement: { create: vi.fn() },
  },
}));

vi.mock('../../shared/services/batch.service', () => ({
  batchService: {
    createBatch: vi.fn(),
  },
}));

describe('ReceiptService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createReceipt', () => {
    it('refuse une réception rattachée à un fournisseur ARCHIVÉ', async () => {
      vi.mocked(prisma.supplier.findFirst).mockResolvedValue({
        id: 'supp-1',
        is_active: false,
      } as never);

      await expect(
        receiptService.createReceipt({
          organization_id: 'org-1',
          id_fournisseur: 'supp-1',
          shipment_id: 'SHIP-ARCH',
          id_produit: 'prod-1',
          quantite_actuelle: 10,
          unite_code: 'KG',
          statut_controle: 'OK',
          received_by: 'user-1',
        })
      ).rejects.toMatchObject({ status: 409 });

      expect(batchService.createBatch).not.toHaveBeenCalled();
    });

    it('doit créer une réception et un lot au sein d une transaction', async () => {
      const payload = {
        organization_id: 'org-1',
        id_fournisseur: 'supp-1',
        shipment_id: 'SHIP-001',
        id_produit: 'prod-1',
        quantite_actuelle: 500,
        unite_code: 'KG',
        statut_controle: 'OK',
        received_by: 'user-1',
      };

      // Mocks

      vi.mocked(prisma.supplier.findFirst).mockResolvedValue({
        id: 'supp-1',
        is_active: true,
      } as never);
      vi.mocked(prisma.product.findFirst).mockResolvedValue({
        id: 'prod-1',
        code_gtin: '3456789012345',
        is_active: true,
      } as never);

      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-1' } as never);

      vi.mocked(prisma.unit.findUnique).mockResolvedValue({ code: 'KG' } as never);

      vi.mocked(prisma.receipt.create).mockResolvedValue({ id: 'rec-1' } as never);
      vi.mocked(batchService.createBatch).mockResolvedValue({
        id: 'bat-1',
        lot_number: '260704-ABC123',
      } as never);

      const result = await receiptService.createReceipt(payload);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.receipt.create).toHaveBeenCalled();
      expect(batchService.createBatch).toHaveBeenCalled();
      // Le lot est rattaché (FK) à sa réception : c'est ce lien qui fait remonter la généalogie
      // jusqu'au fournisseur.
      expect(batchService.createBatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id_receipt: 'rec-1' })
      );
      expect(result.receiptId).toBe('rec-1');
      expect(result.batchId).toBe('bat-1');
    });

    it('la réception est le premier maillon de l historique du lot', async () => {
      const payload = {
        organization_id: 'org-1',
        id_fournisseur: 'supp-1',
        shipment_id: 'SHIP-001',
        id_produit: 'prod-1',
        quantite_actuelle: 500,
        unite_code: 'KG',
        statut_controle: 'OK',
        received_by: 'user-1',
      };

      vi.mocked(prisma.supplier.findFirst).mockResolvedValue({
        id: 'supp-1',
        is_active: true,
      } as never);
      vi.mocked(prisma.product.findFirst).mockResolvedValue({
        id: 'prod-1',
        code_gtin: '3456789012345',
        is_active: true,
      } as never);

      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-1' } as never);

      vi.mocked(prisma.unit.findUnique).mockResolvedValue({ code: 'KG' } as never);

      vi.mocked(prisma.receipt.create).mockResolvedValue({ id: 'rec-1' } as never);
      vi.mocked(batchService.createBatch).mockResolvedValue({
        id: 'bat-1',
        lot_number: '260704-ABC123',
      } as never);

      await receiptService.createReceipt(payload);

      // Sans ce mouvement, un lot reçu et jamais transformé n'a AUCUNE trace de son
      // arrivée : sa fiche affiche un historique vide alors qu'il existe bel et bien.
      expect(prisma.batch_Mouvement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id_lot: 'bat-1',
          type_action: 'RECEPTION',
          quantite: 500,
          unite: 'KG',
          id_user: 'user-1',
          metadata: expect.objectContaining({
            id_receipt: 'rec-1',
            id_fournisseur: 'supp-1',
            quarantaine: false,
          }),
        }),
      });
    });

    it('doit émettre un ObjectEvent EPCIS avec URN LGTIN (préfixe GS1 de l organisation)', async () => {
      const payload = {
        organization_id: 'org-1',
        id_fournisseur: 'supp-1',
        shipment_id: 'SHIP-001',
        id_produit: 'prod-1',
        quantite_actuelle: 500,
        unite_code: 'KG',
        statut_controle: 'OK',
        received_by: 'user-1',
      };

      vi.mocked(prisma.supplier.findFirst).mockResolvedValue({
        id: 'supp-1',
        is_active: true,
      } as never);
      vi.mocked(prisma.product.findFirst).mockResolvedValue({
        id: 'prod-1',
        code_gtin: '3456789012345',
        is_active: true,
      } as never);
      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        gs1_company_prefix: '0614141',
      } as never);

      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-1' } as never);

      vi.mocked(prisma.unit.findUnique).mockResolvedValue({ code: 'KG' } as never);

      vi.mocked(prisma.receipt.create).mockResolvedValue({ id: 'rec-1' } as never);
      vi.mocked(batchService.createBatch).mockResolvedValue({
        id: 'bat-1',
        lot_number: '260704-ABC123',
      } as never);

      await receiptService.createReceipt(payload);

      expect(prisma.ePCIS_Event.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organization_id: 'org-1',
          event_type: 'ObjectEvent',
          related_entity: 'Receipt',
          related_id: 'rec-1',
          payload: expect.objectContaining({
            quantityList: [
              {
                epcClass: 'urn:epc:class:lgtin:0614141.001234.260704-ABC123',
                quantity: 500,
                uom: 'KG',
              },
            ],
            action: 'ADD',
            bizStep: 'urn:epcglobal:cbv:bizstep:receiving',
            disposition: 'urn:epcglobal:cbv:disp:active',
            sourceParty: 'supp-1',
          }),
        }),
      });

      // L'event EPCIS et l'audit WORM sont émis dans la même transaction que la réception
      expect(prisma.audit_Log.create).toHaveBeenCalled();
    });

    it('doit utiliser le préfixe GS1 de repli si l organisation n en a pas', async () => {
      vi.mocked(prisma.supplier.findFirst).mockResolvedValue({
        id: 'supp-1',
        is_active: true,
      } as never);
      vi.mocked(prisma.product.findFirst).mockResolvedValue({
        id: 'prod-1',
        code_gtin: '3456789012345',
        is_active: true,
      } as never);

      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        gs1_company_prefix: null,
      } as never);

      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-1' } as never);

      vi.mocked(prisma.unit.findUnique).mockResolvedValue({ code: 'KG' } as never);

      vi.mocked(prisma.receipt.create).mockResolvedValue({ id: 'rec-1' } as never);
      vi.mocked(batchService.createBatch).mockResolvedValue({
        id: 'bat-1',
        lot_number: '260704-ABC123',
      } as never);

      await receiptService.createReceipt({
        organization_id: 'org-1',
        id_fournisseur: 'supp-1',
        shipment_id: 'SHIP-001',
        id_produit: 'prod-1',
        quantite_actuelle: 500,
        unite_code: 'KG',
        statut_controle: 'OK',
        received_by: 'user-1',
      });

      expect(prisma.ePCIS_Event.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            quantityList: [
              expect.objectContaining({
                epcClass: 'urn:epc:class:lgtin:3456789.001234.260704-ABC123',
              }),
            ],
          }),
        }),
      });
    });

    // Le statut de contrôle à la réception détermine le statut initial du lot :
    // NONCONFORME/ALERTE -> quarantaine (BLOQUE), sinon stock normal (EN_STOCK).
    it.each([
      ['NONCONFORME', 'BLOQUE'],
      ['ALERTE', 'BLOQUE'],
      ['OK', 'EN_STOCK'],
      ['CONFORME', 'EN_STOCK'],
    ])('réception %s -> lot créé en %s', async (statut_controle, statutLotAttendu) => {
      const mockOk = (id: string) => ({ id, is_active: true }) as never;
      vi.mocked(prisma.supplier.findFirst).mockResolvedValue(mockOk('supp-1'));
      vi.mocked(prisma.product.findFirst).mockResolvedValue({
        id: 'prod-1',
        code_gtin: '3456789012345',
        is_active: true,
      } as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockOk('user-1'));
      vi.mocked(prisma.unit.findUnique).mockResolvedValue({ code: 'KG' } as never);
      vi.mocked(prisma.receipt.create).mockResolvedValue(mockOk('rec-1'));
      vi.mocked(batchService.createBatch).mockResolvedValue({
        id: 'bat-1',
        lot_number: '260704-ABC123',
      } as never);

      await receiptService.createReceipt({
        organization_id: 'org-1',
        id_fournisseur: 'supp-1',
        shipment_id: 'SHIP-001',
        id_produit: 'prod-1',
        quantite_actuelle: 500,
        unite_code: 'KG',
        statut_controle,
        received_by: 'user-1',
      });

      expect(batchService.createBatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ statut: statutLotAttendu })
      );
    });

    it('doit échouer si le fournisseur n appartient pas à l organisation', async () => {
      vi.mocked(prisma.supplier.findFirst).mockResolvedValue(null);

      const action = receiptService.createReceipt({
        organization_id: 'org-1',
        id_fournisseur: 'supp-wrong',
        id_produit: 'prod-1',
      } as never);

      await expect(action).rejects.toThrow(APIError);
      await expect(action).rejects.toMatchObject({
        status: 404,
        body: { error: [{ field: 'id_fournisseur' }] },
      });
    });

    it('doit échouer si le produit n appartient pas à l organisation (Faille Critique #1)', async () => {
      // Le fournisseur est OK

      vi.mocked(prisma.supplier.findFirst).mockResolvedValue({
        id: 'supp-1',
        is_active: true,
      } as never);
      // MAIS le produit est introuvable pour cette org
      vi.mocked(prisma.product.findFirst).mockResolvedValue(null);

      const action = receiptService.createReceipt({
        organization_id: 'org-1',
        id_fournisseur: 'supp-1',
        id_produit: 'prod-leak',
      } as never);

      await expect(action).rejects.toThrow(APIError);
      await expect(action).rejects.toMatchObject({
        status: 404,
        body: { error: [{ field: 'id_produit', message: 'Produit introuvable ou accès refusé' }] },
      });

      // Vérifier que where inclut bien organization_id
      expect(prisma.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'prod-leak', organization_id: 'org-1' },
        })
      );
    });
  });

  describe('le lot du fournisseur et sa date de péremption', () => {
    /** Réception valide, à laquelle chaque test ajoute ce qu'il veut éprouver. */
    const baseReceipt = {
      organization_id: 'org-1',
      id_fournisseur: 'supp-1',
      shipment_id: 'SHIP-001',
      id_produit: 'prod-1',
      quantite_actuelle: 500,
      unite_code: 'KG',
      statut_controle: 'OK',
      received_by: 'user-1',
    };

    /** `duree_conservation_defaut` est en JOURS : c'est le repli quand le fournisseur n'imprime pas de DLC. */
    const mockValidReception = (dureeConservationJours = 30) => {
      vi.mocked(prisma.supplier.findFirst).mockResolvedValue({
        id: 'supp-1',
        is_active: true,
      } as never);
      vi.mocked(prisma.product.findFirst).mockResolvedValue({
        id: 'prod-1',
        code_gtin: '3042040209123',
        is_active: true,
        duree_conservation_defaut: dureeConservationJours,
      } as never);

      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-1' } as never);

      vi.mocked(prisma.unit.findUnique).mockResolvedValue({ code: 'KG' } as never);

      vi.mocked(prisma.receipt.create).mockResolvedValue({ id: 'rec-1' } as never);
      vi.mocked(batchService.createBatch).mockResolvedValue({
        id: 'bat-1',
        lot_number: '260714-ABC123',
      } as never);
    };

    it("garde le numéro de lot imprimé par le fournisseur, au lieu d'en inventer un", async () => {
      mockValidReception();

      await receiptService.createReceipt({ ...baseReceipt, lot_number: 'ABC123' });

      expect(batchService.createBatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ lot_number: 'ABC123' })
      );
    });

    it("laisse le serveur générer le numéro quand l'étiquette n'en porte pas", async () => {
      mockValidReception();

      await receiptService.createReceipt(baseReceipt);

      expect(batchService.createBatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ lot_number: undefined })
      );
    });

    // « À consommer jusqu'au 20/07 » veut dire le 20/07 INCLUS. Les gardes « lot périmé » comparent
    // `date_peremption < now` : ancrée à minuit, la DLC rendrait le lot inexpédiable dès 00h01 ce
    // jour-là. Un lot reçu avec une DLC du jour même (lait cru : 4 jours) serait mort-né.
    it("laisse le lot vivre tout son dernier jour, pas jusqu'à minuit", async () => {
      mockValidReception();
      vi.setSystemTime(new Date('2026-07-20T09:00:00.000Z'));

      await receiptService.createReceipt({ ...baseReceipt, date_peremption: '2026-07-20' });

      const [, batchInput] = vi.mocked(batchService.createBatch).mock.calls[0];
      expect(batchInput.date_peremption?.toISOString()).toBe('2026-07-20T23:59:59.999Z');
      // La garde d'expédition/transformation ne doit PAS le voir périmé aujourd'hui.
      expect(batchInput.date_peremption!.getTime()).toBeGreaterThan(Date.now());
    });

    // `2026-02-30` passe le regex, mais Date le REPORTE au 2 mars : une DLC allongée de deux jours,
    // en silence, sur une donnée sanitaire.
    it('refuse un jour qui n’existe pas, au lieu de le décaler en silence', async () => {
      mockValidReception();

      const action = receiptService.createReceipt({
        ...baseReceipt,
        date_peremption: '2026-02-30',
      });

      await expect(action).rejects.toMatchObject({
        status: 400,
        body: { error: [{ field: 'date_peremption' }] },
      });
      expect(batchService.createBatch).not.toHaveBeenCalled();
    });

    it('refuse une DLC déjà passée (AI 17 mal lu, faute de frappe)', async () => {
      mockValidReception();
      vi.setSystemTime(new Date('2026-07-14T09:00:00.000Z'));

      const action = receiptService.createReceipt({
        ...baseReceipt,
        date_peremption: '2020-01-01',
      });

      await expect(action).rejects.toMatchObject({
        status: 400,
        body: { error: [{ field: 'date_peremption' }] },
      });
    });

    it('à défaut de DLC imprimée, applique la durée de conservation du produit', async () => {
      mockValidReception(30);
      vi.setSystemTime(new Date('2026-07-14T09:30:00.000Z'));

      await receiptService.createReceipt(baseReceipt);

      const [, batchInput] = vi.mocked(batchService.createBatch).mock.calls[0];
      expect(batchInput.date_peremption?.toISOString()).toBe('2026-08-13T23:59:59.999Z');
    });

    // Une durée nulle ou négative ferait naître le lot périmé, donc inexpédiable dans la seconde.
    it("n'invente pas de DLC quand la durée de conservation du produit est absurde", async () => {
      mockValidReception(0);

      await receiptService.createReceipt(baseReceipt);

      const [, batchInput] = vi.mocked(batchService.createBatch).mock.calls[0];
      expect(batchInput.date_peremption).toBeUndefined();
    });

    it('normalise la casse du numéro de lot (sinon la même palette entre deux fois)', async () => {
      mockValidReception();

      await receiptService.createReceipt({ ...baseReceipt, lot_number: 'abc123' });

      expect(batchService.createBatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ lot_number: 'ABC123' })
      );
    });

    // Sans ça, la garde « lot périmé » reste du code mort : 100 % des lots réels naissent sans DLC.
    it('ne laisse JAMAIS un lot naître sans date de péremption', async () => {
      mockValidReception(30);

      await receiptService.createReceipt(baseReceipt);

      const [, batchInput] = vi.mocked(batchService.createBatch).mock.calls[0];
      expect(batchInput.date_peremption).toBeInstanceOf(Date);
    });

    it('refuse un numéro de lot déjà reçu, en désignant le lot existant', async () => {
      mockValidReception();
      vi.mocked(batchService.createBatch).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.0.0',
        })
      );

      const action = receiptService.createReceipt({ ...baseReceipt, lot_number: 'ABC123' });

      await expect(action).rejects.toMatchObject({
        status: 409,
        body: { error: [{ field: 'lot_number' }] },
      });
    });
  });

  describe('listReceipts', () => {
    const mockPage = (total = 0, rows: unknown[] = []) => {
      vi.mocked(prisma.receipt.count).mockResolvedValue(total as never);
      vi.mocked(prisma.receipt.findMany).mockResolvedValue(rows as never);
    };

    it('cloisonne par organisation et décale selon la page', async () => {
      mockPage();
      await receiptService.listReceipts('org-1', { page: 2, limit: 25 });
      expect(prisma.receipt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organization_id: 'org-1' }),
          skip: 25,
          take: 25,
        })
      );
    });

    it('filtre par ref (shipment_id), fournisseur et statut', async () => {
      mockPage();
      await receiptService.listReceipts('org-1', {
        ref: 'BL-2026',
        fournisseur: 'four-1',
        statut: 'ALERTE',
      });
      expect(prisma.receipt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            shipment_id: { contains: 'BL-2026', mode: 'insensitive' },
            id_fournisseur: 'four-1',
            statut_controle: 'ALERTE',
          }),
        })
      );
    });

    it('filtre « un jour » sur la borne [jour, lendemain[ en UTC', async () => {
      mockPage();
      await receiptService.listReceipts('org-1', { date: '2026-07-31' });
      const where = vi.mocked(prisma.receipt.findMany).mock.calls.at(-1)?.[0]?.where as unknown as {
        date_reception?: { gte: Date; lt: Date };
      };
      expect(where.date_reception?.gte.toISOString()).toBe('2026-07-31T00:00:00.000Z');
      expect(where.date_reception?.lt.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    });

    it('compte le total sur le MÊME where que la page', async () => {
      mockPage();
      await receiptService.listReceipts('org-1', { statut: 'OK' });
      const countArgs = vi.mocked(prisma.receipt.count).mock.calls.at(-1)?.[0];
      const findArgs = vi.mocked(prisma.receipt.findMany).mock.calls.at(-1)?.[0];
      expect(countArgs?.where).toEqual(findArgs?.where);
    });
  });
});
