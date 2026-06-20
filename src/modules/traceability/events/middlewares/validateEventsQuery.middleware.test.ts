import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response, NextFunction } from 'express';
import { validateEventsQuery } from './validateEventsQuery.middleware';
import type { AuthenticatedRequest } from '../../../identity/types/auth.types';

const res = {} as Response;

const buildReq = (query: unknown): AuthenticatedRequest =>
  ({ query }) as unknown as AuthenticatedRequest;

const errorFrom = (next: ReturnType<typeof vi.fn>) =>
  next.mock.calls[0][0] as { status: number; error: { field: string }[] };

describe('validateEventsQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('query vide → next() sans erreur, aucun filtre', async () => {
    const req = buildReq({});
    const next = vi.fn() as NextFunction;

    await validateEventsQuery(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.validatedEventsQuery).toEqual({});
  });

  it('coerce page/limit en nombres et conserve les filtres valides', async () => {
    const req = buildReq({
      page: '2',
      limit: '50',
      event_type: 'ObjectEvent',
      related_entity: 'Receipt',
    });
    const next = vi.fn() as NextFunction;

    await validateEventsQuery(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.validatedEventsQuery).toEqual({
      page: 2,
      limit: 50,
      event_type: 'ObjectEvent',
      related_entity: 'Receipt',
    });
  });

  it('rejette un limit non numérique → 400 sur le champ limit', async () => {
    const req = buildReq({ limit: 'abc' });
    const next = vi.fn() as NextFunction;

    await validateEventsQuery(req, res, next);

    const err = errorFrom(next as ReturnType<typeof vi.fn>);
    expect(err.status).toBe(400);
    expect(err.error[0].field).toBe('limit');
  });

  it('rejette un limit au-dessus du plafond 500 → 400 sur le champ limit', async () => {
    const req = buildReq({ limit: '501' });
    const next = vi.fn() as NextFunction;

    await validateEventsQuery(req, res, next);

    const err = errorFrom(next as ReturnType<typeof vi.fn>);
    expect(err.status).toBe(400);
    expect(err.error[0].field).toBe('limit');
  });

  it('rejette une page inférieure à 1 → 400 sur le champ page', async () => {
    const req = buildReq({ page: '0' });
    const next = vi.fn() as NextFunction;

    await validateEventsQuery(req, res, next);

    const err = errorFrom(next as ReturnType<typeof vi.fn>);
    expect(err.status).toBe(400);
    expect(err.error[0].field).toBe('page');
  });

  it('rejette un event_type hors vocabulaire → 400 sur le champ event_type', async () => {
    const req = buildReq({ event_type: 'FakeEvent' });
    const next = vi.fn() as NextFunction;

    await validateEventsQuery(req, res, next);

    const err = errorFrom(next as ReturnType<typeof vi.fn>);
    expect(err.status).toBe(400);
    expect(err.error[0].field).toBe('event_type');
  });

  it('rejette un related_entity hors vocabulaire → 400 sur le champ related_entity', async () => {
    const req = buildReq({ related_entity: 'Pizza' });
    const next = vi.fn() as NextFunction;

    await validateEventsQuery(req, res, next);

    const err = errorFrom(next as ReturnType<typeof vi.fn>);
    expect(err.status).toBe(400);
    expect(err.error[0].field).toBe('related_entity');
  });
});
