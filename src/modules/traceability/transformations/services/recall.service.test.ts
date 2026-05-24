import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recallService } from './recall.service';
import { genealogyService } from './genealogy.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { Batch } from '@prisma/client';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    $transaction: vi.fn(),
    batch: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    alert: {
      create: vi.fn(),
    },
  },
}));

vi.mock('./genealogy.service', () => ({
  genealogyService: {
    getDownstream: vi.fn(),
  },
}));

describe('RecallService', () => {
  const orgId = 'org-123';
  const userId = 'user-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('doit bloquer le lot source et tous ses descendants', async () => {
    const batchId = 'batch-root';

    // Mock simple transaction
    vi.mocked(prisma.$transaction).mockImplementation((cb: (tx: unknown) => Promise<unknown>) =>
      cb(prisma)
    );

    // Mock find source batch
    vi.mocked(prisma.batch.findFirst).mockResolvedValue({
      id: batchId,
      organization_id: orgId,
    } as unknown as Batch);

    // Mock descendants
    vi.mocked(genealogyService.getDownstream).mockResolvedValue([
      { id: 'batch-child-1', organization_id: orgId } as unknown as Batch,
      { id: 'batch-child-2', organization_id: orgId } as unknown as Batch,
    ]);

    const result = await recallService.triggerRecall(batchId, orgId, userId, 'Test Recall');

    expect(result.blockedBatchesCount).toBe(3); // Root + 2 children
    expect(prisma.batch.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['batch-root', 'batch-child-1', 'batch-child-2'] },
        organization_id: orgId,
      },
      data: { statut: 'ALERTE' },
    });
    expect(prisma.alert.create).toHaveBeenCalled();
  });
});
