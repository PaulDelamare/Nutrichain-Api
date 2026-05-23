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
    user: { findUnique: vi.fn() },
    unit: { findUnique: vi.fn() },
    receipt: { create: vi.fn(), count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    batch: { findFirst: vi.fn() },
    audit_Log: { findFirst: vi.fn(), create: vi.fn() },
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.product.findFirst).mockResolvedValue({ id: 'prod-1' } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-1' } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.unit.findUnique).mockResolvedValue({ code: 'KG' } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.receipt.create).mockResolvedValue({ id: 'rec-1' } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(batchService.createBatch).mockResolvedValue({ id: 'bat-1' } as any);

      const result = await receiptService.createReceipt(payload);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.receipt.create).toHaveBeenCalled();
      expect(batchService.createBatch).toHaveBeenCalled();
      expect(result.receiptId).toBe('rec-1');
      expect(result.batchId).toBe('bat-1');
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
        body: { error: [{ field: 'id_fournisseur' }] }
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
        body: { error: [{ field: 'id_produit', message: 'Produit introuvable ou accès refusé' }] }
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
