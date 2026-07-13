import { describe, it, expect, vi, beforeEach } from 'vitest';
import { batchService } from './batch.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { auditService } from '../../../../shared/utils/audit/audit.service';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    batch: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    batch_Mouvement: { create: vi.fn() },
    // Simule une transaction en passant le mock prisma au callback
    $transaction: vi.fn(async (cb) => cb(prisma)),
  },
}));

vi.mock('../../../../shared/utils/audit/audit.service', () => ({
  auditService: { logAction: vi.fn() },
}));

describe('BatchSharedService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createBatch', () => {
    it('doit créer un lot avec les données fournies', async () => {
      const mockTx = {
        batch: {
          create: vi.fn().mockResolvedValue({ id: 'batch-123' }),
        },
      };

      const data = {
        organization_id: 'org-1',
        id_produit: 'prod-1',
        quantite_actuelle: 100,
        unite_code: 'KG',
        created_by: 'user-1',
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await batchService.createBatch(mockTx as any, data);

      expect(mockTx.batch.create).toHaveBeenCalledWith({
        data: {
          ...data,
          date_peremption: undefined,
          lot_number: expect.stringMatching(/^[0-9]{6}-[0-9A-Z]{6}$/),
          quantite_base: data.quantite_actuelle,
          statut: 'EN_STOCK',
        },
      });
      expect(result.id).toBe('batch-123');
    });

    it('doit créer le lot avec le statut initial fourni (quarantaine BLOQUE)', async () => {
      const mockTx = {
        batch: {
          create: vi.fn().mockResolvedValue({ id: 'batch-456' }),
        },
      };

      const data = {
        organization_id: 'org-1',
        id_produit: 'prod-1',
        quantite_actuelle: 100,
        unite_code: 'KG',
        created_by: 'user-1',
        statut: 'BLOQUE' as const,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await batchService.createBatch(mockTx as any, data);

      expect(mockTx.batch.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ statut: 'BLOQUE' }),
      });
    });
  });

  describe('liftQuarantine', () => {
    it('doit lever la quarantaine (BLOQUE -> EN_STOCK) et tracer la décision dans l audit', async () => {
      vi.mocked(prisma.batch.findFirst).mockResolvedValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'batch-1', organization_id: 'org-1', statut: 'BLOQUE' } as any
      );
      vi.mocked(prisma.batch.update).mockResolvedValue({
        id: 'batch-1',
        statut: 'EN_STOCK',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await batchService.liftQuarantine(
        'batch-1',
        'org-1',
        'user-1',
        'Contrôle refait OK'
      );

      expect(prisma.batch.update).toHaveBeenCalledWith({
        where: { id: 'batch-1' },
        data: expect.objectContaining({ statut: 'EN_STOCK' }),
      });
      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LIFT_BATCH_QUARANTINE',
          entity: 'Batch',
          entityId: 'batch-1',
          oldValue: { statut: 'BLOQUE' },
          newValue: expect.objectContaining({ statut: 'EN_STOCK', motif: 'Contrôle refait OK' }),
        }),
        expect.anything()
      );
      expect(result.statut).toBe('EN_STOCK');
    });

    it('la levée entre dans l historique du lot, avec son motif', async () => {
      vi.mocked(prisma.batch.findFirst).mockResolvedValue({
        id: 'batch-1',
        organization_id: 'org-1',
        statut: 'BLOQUE',
        quantite_actuelle: 42,
        unite_code: 'KG',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.batch.update).mockResolvedValue({ id: 'batch-1' } as any);

      await batchService.liftQuarantine('batch-1', 'org-1', 'user-1', '2e contrôle conforme');

      // Sans ce mouvement, la décision qualité n'apparaît nulle part sur la fiche du lot :
      // le lot redevient « conforme » sans que rien n'explique pourquoi.
      expect(prisma.batch_Mouvement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id_lot: 'batch-1',
          type_action: 'LEVEE_QUARANTAINE',
          quantite: 42,
          unite: 'KG',
          id_user: 'user-1',
          metadata: expect.objectContaining({ motif: '2e contrôle conforme' }),
        }),
      });
    });

    it('doit refuser (404) un lot d une autre organisation', async () => {
      vi.mocked(prisma.batch.findFirst).mockResolvedValue(null);

      const action = batchService.liftQuarantine('batch-x', 'org-1', 'user-1', 'motif');
      await expect(action).rejects.toMatchObject({ status: 404 });
      expect(prisma.batch.update).not.toHaveBeenCalled();
    });

    it('doit refuser (409) la levée si le lot n est pas en quarantaine', async () => {
      vi.mocked(prisma.batch.findFirst).mockResolvedValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'batch-1', organization_id: 'org-1', statut: 'EN_STOCK' } as any
      );

      const action = batchService.liftQuarantine('batch-1', 'org-1', 'user-1', 'motif');
      await expect(action).rejects.toThrow(APIError);
      await expect(action).rejects.toMatchObject({ status: 409 });
      expect(prisma.batch.update).not.toHaveBeenCalled();
      expect(auditService.logAction).not.toHaveBeenCalled();
    });
  });
});
