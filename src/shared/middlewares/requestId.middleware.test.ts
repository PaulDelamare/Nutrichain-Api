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

  it('doit régénérer un UUID si le X-Request-ID entrant contient des caractères de contrôle (anti CRLF log-injection)', () => {
    const malicious = 'fake-id\r\nFAKE_LOG: injected';
    const req = buildReq(malicious);
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    requestIdMiddleware(req, res, next);

    expect(req.requestId).not.toBe(malicious);
    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('doit régénérer un UUID si le X-Request-ID entrant dépasse 128 caractères', () => {
    const oversized = 'a'.repeat(129);
    const req = buildReq(oversized);
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    requestIdMiddleware(req, res, next);

    expect(req.requestId).not.toBe(oversized);
    expect(req.requestId!.length).toBeLessThanOrEqual(128);
  });
});
