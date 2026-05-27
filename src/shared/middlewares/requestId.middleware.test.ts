import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requestIdMiddleware } from './requestId.middleware';

const buildReq = (incomingHeader?: string): Request =>
  ({
    header: vi.fn((name: string) =>
      name.toLowerCase() === 'x-request-id' ? incomingHeader : undefined
    ),
  }) as unknown as Request;

const buildRes = (): Response =>
  ({
    setHeader: vi.fn(),
  }) as unknown as Response;

describe('requestIdMiddleware', () => {
  it('doit générer un UUID si aucun X-Request-ID entrant', () => {
    const req = buildReq();
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    requestIdMiddleware(req, res, next);

    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', req.requestId);
    expect(next).toHaveBeenCalledWith();
  });

  it('doit propager le X-Request-ID entrant tel quel', () => {
    const incoming = 'tracing-id-from-edge-7a2b';
    const req = buildReq(incoming);
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    requestIdMiddleware(req, res, next);

    expect(req.requestId).toBe(incoming);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', incoming);
    expect(next).toHaveBeenCalledWith();
  });
});
