import { describe, it, expect, vi, beforeEach } from 'vitest';
import { receiptService } from './receipt.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { batchService } from '../../shared/services/batch.service';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    $transaction: vi.fn(async (callback) => {
      // Simulation réaliste : on passe le mock de prisma au callback
      return callback(prisma);
    }),
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
  });

  describe('createReceipt', () => {
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.supplier.findFirst).mockResolvedValue({ id: 'supp-1' } as any);
      vi.mocked(prisma.product.findFirst).mockResolvedValue({
        id: 'prod-1',
        code_gtin: '3456789012345',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-1' } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.unit.findUnique).mockResolvedValue({ code: 'KG' } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.receipt.create).mockResolvedValue({ id: 'rec-1' } as any);
      vi.mocked(batchService.createBatch).mockResolvedValue({
        id: 'bat-1',
        lot_number: '260704-ABC123',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await receiptService.createReceipt(payload);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.receipt.create).toHaveBeenCalled();
      expect(batchService.createBatch).toHaveBeenCalled();
      expect(result.receiptId).toBe('rec-1');
      expect(result.batchId).toBe('bat-1');
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.supplier.findFirst).mockResolvedValue({ id: 'supp-1' } as any);
      vi.mocked(prisma.product.findFirst).mockResolvedValue({
        id: 'prod-1',
        code_gtin: '3456789012345',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        gs1_company_prefix: '0614141',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-1' } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.unit.findUnique).mockResolvedValue({ code: 'KG' } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.receipt.create).mockResolvedValue({ id: 'rec-1' } as any);
      vi.mocked(batchService.createBatch).mockResolvedValue({
        id: 'bat-1',
        lot_number: '260704-ABC123',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.supplier.findFirst).mockResolvedValue({ id: 'supp-1' } as any);
      vi.mocked(prisma.product.findFirst).mockResolvedValue({
        id: 'prod-1',
        code_gtin: '3456789012345',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        gs1_company_prefix: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-1' } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.unit.findUnique).mockResolvedValue({ code: 'KG' } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.receipt.create).mockResolvedValue({ id: 'rec-1' } as any);
      vi.mocked(batchService.createBatch).mockResolvedValue({
        id: 'bat-1',
        lot_number: '260704-ABC123',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

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
      const mockOk = (id: string) => ({ id }) as never;
      vi.mocked(prisma.supplier.findFirst).mockResolvedValue(mockOk('supp-1'));
      vi.mocked(prisma.product.findFirst).mockResolvedValue({
        id: 'prod-1',
        code_gtin: '3456789012345',
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      await expect(action).rejects.toThrow(APIError);
      await expect(action).rejects.toMatchObject({
        status: 404,
        body: { error: [{ field: 'id_fournisseur' }] },
      });
    });

    it('doit échouer si le produit n appartient pas à l organisation (Faille Critique #1)', async () => {
      // Le fournisseur est OK
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.supplier.findFirst).mockResolvedValue({ id: 'supp-1' } as any);
      // MAIS le produit est introuvable pour cette org
      vi.mocked(prisma.product.findFirst).mockResolvedValue(null);

      const action = receiptService.createReceipt({
        organization_id: 'org-1',
        id_fournisseur: 'supp-1',
        id_produit: 'prod-leak',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

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
});
