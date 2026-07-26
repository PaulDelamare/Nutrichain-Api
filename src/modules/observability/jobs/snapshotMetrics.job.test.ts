import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../models/metricsSnapshot.model', () => ({
  MetricsSnapshotModel: { insertMany: vi.fn() },
}));

vi.mock('../middlewares/metricsStore', () => ({
  getAndResetAllOrganizationTotals: vi.fn(),
}));

vi.mock('../../../shared/utils/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runSnapshotMetricsOnce } from './snapshotMetrics.job';
import { MetricsSnapshotModel } from '../models/metricsSnapshot.model';
import { getAndResetAllOrganizationTotals } from '../middlewares/metricsStore';
import { logger } from '../../../shared/utils/logger/logger';

describe('snapshotMetrics job', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('1. une organisation avec du trafic : un document inséré avec les totaux exacts', async () => {
    vi.mocked(getAndResetAllOrganizationTotals).mockReturnValue([
      { organizationId: 'org-a', count: 15, errorCount: 2 },
    ]);

    await runSnapshotMetricsOnce();

    expect(MetricsSnapshotModel.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        metadata: { organization_id: 'org-a' },
        request_count: 15,
        error_count: 2,
        timestamp: expect.any(Date),
      }),
    ]);
  });

  it('2. plusieurs organisations : un document par organisation, dans le même insertMany', async () => {
    vi.mocked(getAndResetAllOrganizationTotals).mockReturnValue([
      { organizationId: 'org-a', count: 3, errorCount: 0 },
      { organizationId: 'org-b', count: 7, errorCount: 1 },
    ]);

    await runSnapshotMetricsOnce();

    const inserted = vi.mocked(MetricsSnapshotModel.insertMany).mock.calls[0][0] as Array<{
      metadata: { organization_id: string };
      request_count: number;
    }>;
    expect(inserted).toHaveLength(2);
    expect(inserted.find((d) => d.metadata.organization_id === 'org-a')?.request_count).toBe(3);
    expect(inserted.find((d) => d.metadata.organization_id === 'org-b')?.request_count).toBe(7);
  });

  it('3. aucun trafic depuis le dernier snapshot : insertMany non appelé (pas de document vide)', async () => {
    vi.mocked(getAndResetAllOrganizationTotals).mockReturnValue([]);

    await expect(runSnapshotMetricsOnce()).resolves.toBeUndefined();
    expect(MetricsSnapshotModel.insertMany).not.toHaveBeenCalled();
  });

  it('4. insertMany échoue : logué en warn, le job ne rejette jamais (ne doit pas crasher le process)', async () => {
    vi.mocked(getAndResetAllOrganizationTotals).mockReturnValue([
      { organizationId: 'org-a', count: 1, errorCount: 0 },
    ]);
    vi.mocked(MetricsSnapshotModel.insertMany).mockRejectedValue(new Error('mongo down'));

    await expect(runSnapshotMetricsOnce()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('mongo down'));
  });

  it('5. tous les totaux sont lus en un seul appel (pas un par organisation) — pas de fenêtre entre deux lectures qui perdrait du trafic', async () => {
    vi.mocked(getAndResetAllOrganizationTotals).mockReturnValue([]);

    await runSnapshotMetricsOnce();

    expect(getAndResetAllOrganizationTotals).toHaveBeenCalledTimes(1);
  });
});
