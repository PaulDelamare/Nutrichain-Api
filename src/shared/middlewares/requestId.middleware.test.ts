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

  /**
   * Les bornes sont testées AUX limites : un test qui n'exerce que « 129 caractères » resterait
   * vert si le plafond repassait de 64 à 128, puisqu'un UUID de 36 satisfait les deux.
   */
  it.each([
    ['64 caractères', 'a'.repeat(64), true],
    ['65 caractères', 'a'.repeat(65), false],
    ['8 caractères', 'a'.repeat(8), true],
    ['7 caractères', 'a'.repeat(7), false],
  ])('accepte/refuse un X-Request-ID de %s', (_cas, incoming, accepted) => {
    const req = buildReq(incoming);
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    requestIdMiddleware(req, res, next);

    if (accepted) {
      expect(req.requestId).toBe(incoming);
    } else {
      expect(req.requestId).not.toBe(incoming);
      expect(req.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    }
  });

  /**
   * Depuis #252, cette valeur repart dans le CORPS d'une réponse d'erreur et plus seulement dans
   * un en-tête : l'absence de CR/LF ne suffit plus à la rendre inoffensive pour un consommateur
   * qui la rendrait sans échapper.
   */
  it.each([
    ['des chevrons', '<script>alert(1)</script>'],
    ['des guillemets', 'id"onload="x'],
    ['une apostrophe', "id'--"],
    ['une esperluette', 'id&amp;entity'],
    ['un espace', 'id avec espace'],
    ['une valeur trop courte pour corréler', 'abc'],
  ])('doit régénérer un UUID si le X-Request-ID entrant contient %s', (_cas, incoming) => {
    const req = buildReq(incoming);
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    requestIdMiddleware(req, res, next);

    expect(req.requestId).not.toBe(incoming);
    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
});
