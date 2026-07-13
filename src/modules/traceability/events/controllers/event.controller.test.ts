import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import { app } from '../../../../app';
import { eventService } from '../services/event.service';

vi.mock('../../../../shared/middlewares/sessionAuth', () => ({
  sessionAuth: vi.fn(() => (req: Request, _res: Response, next: NextFunction) => {
    Object.assign(req, { activeOrgId: 'org_test_123' });
    next();
  }),
}));

vi.mock('../services/event.service', () => ({
  eventService: { listEvents: vi.fn() },
}));

vi.mock('../../../../shared/configs/prismaClient.config', () => {
  const mock = { ePCIS_Event: { count: vi.fn(), findMany: vi.fn() } };
  return { prisma: mock, bdd: mock };
});

describe('GET /api/traceability/events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retourne 200 et transmet org + pagination + filtres validés au service', async () => {
    vi.mocked(eventService.listEvents).mockResolvedValue({
      data: [{ id: 'evt-1' }],
      pagination: { page: 2, limit: 50, total: 1, totalPages: 1 },
    } as never);

    const res = await request(app).get(
      '/api/traceability/events?page=2&limit=50&event_type=ObjectEvent&related_entity=Receipt'
    );

    expect(res.status).toBe(200);
    expect(eventService.listEvents).toHaveBeenCalledWith('org_test_123', 2, 50, {
      eventType: 'ObjectEvent',
      relatedEntity: 'Receipt',
    });
  });

  it('retourne 400 sur une query invalide et n appelle pas le service', async () => {
    const res = await request(app).get('/api/traceability/events?limit=abc');

    expect(res.status).toBe(400);
    expect(eventService.listEvents).not.toHaveBeenCalled();
  });

  it('propage un 401 lorsque le service refuse l absence d organisation', async () => {
    vi.mocked(eventService.listEvents).mockRejectedValue({
      status: 401,
      error: [{ field: 'auth', message: 'Organisation non identifiée.' }],
    });

    const res = await request(app).get('/api/traceability/events');

    expect(res.status).toBe(401);
  });
});
