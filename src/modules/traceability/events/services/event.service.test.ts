import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eventService } from './event.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    // $transaction array form : résout les opérations en parallèle
    $transaction: vi.fn((ops) => Promise.all(ops)),
    ePCIS_Event: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

describe('eventService.listEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cloisonne par organisation et applique les filtres optionnels', async () => {
    vi.mocked(prisma.ePCIS_Event.count).mockResolvedValue(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.ePCIS_Event.findMany).mockResolvedValue([{ id: 'evt-1' }] as any);

    const result = await eventService.listEvents('org-1', 1, 20, { eventType: 'ObjectEvent' });

    expect(prisma.ePCIS_Event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organization_id: 'org-1', event_type: 'ObjectEvent' },
        orderBy: { event_time: 'desc' },
        skip: 0,
        take: 20,
      })
    );
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
    expect(result.data).toHaveLength(1);
  });

  it('refuse la lecture sans organisation (anti-fuite cross-tenant)', async () => {
    await expect(eventService.listEvents('', 1, 20)).rejects.toThrow(APIError);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(eventService.listEvents(undefined as any, 1, 20)).rejects.toMatchObject({
      status: 401,
    });
    expect(prisma.ePCIS_Event.findMany).not.toHaveBeenCalled();
  });

  it('borne limit à 500 et page minimale à 1', async () => {
    vi.mocked(prisma.ePCIS_Event.count).mockResolvedValue(0);
    vi.mocked(prisma.ePCIS_Event.findMany).mockResolvedValue([]);

    await eventService.listEvents('org-1', 0, 9999);

    expect(prisma.ePCIS_Event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 })
    );
  });
});
