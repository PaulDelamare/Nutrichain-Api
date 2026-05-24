import { describe, it, expect, vi, beforeEach } from 'vitest';
import { batchService } from './batch.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    batch: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
  },
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
          quantite_base: data.quantite_actuelle,
          statut: 'EN_STOCK',
        },
      });
      expect(result.id).toBe('batch-123');
    });
  });
});
