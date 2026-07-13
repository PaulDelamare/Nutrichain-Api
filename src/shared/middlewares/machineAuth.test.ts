import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const checkApiKeyInner = vi.fn();

vi.mock('../utils/checkApiKey/checkApiKey', () => ({
  checkApiKey: vi.fn(() => checkApiKeyInner),
}));

import { machineAuth } from './machineAuth';
import { checkApiKey } from '../utils/checkApiKey/checkApiKey';
import { APIError } from '../utils/errorHandler/APIError';
import { AuthenticatedRequest } from '../../modules/identity/types/auth.types';

describe('machineAuth', () => {
  const res = {} as Response;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('authentifie le capteur par sa clé (aucune session possible sur un capteur)', () => {
    const req = { headers: { 'x-api-key': 'cle' } } as unknown as Request;
    const next = vi.fn() as unknown as NextFunction;

    machineAuth()(req, res, next);

    expect(checkApiKey).toHaveBeenCalled();
    expect(checkApiKeyInner).toHaveBeenCalledWith(req, res, expect.any(Function));
  });

  it("refuse l'ingestion si aucune organisation n'est bornée à la clé", () => {
    // Sans organisation, les requêtes Prisma cesseraient de filtrer : la mesure d'un capteur
    // atterrirait dans les données d'un autre client.
    const req = { headers: { 'x-api-key': 'cle' } } as unknown as AuthenticatedRequest;
    const next = vi.fn() as unknown as NextFunction;

    machineAuth()(req, res, next);

    const suite = vi.mocked(checkApiKeyInner).mock.calls[0][2] as NextFunction;
    suite();

    const erreur = vi.mocked(next).mock.calls[0][0] as APIError;
    expect(erreur).toBeInstanceOf(APIError);
    expect(erreur.status).toBe(401);
  });

  it("laisse passer quand l'organisation de la clé est résolue", () => {
    const req = {
      headers: { 'x-api-key': 'cle' },
      activeOrgId: 'usine-laitiere-paris',
    } as unknown as AuthenticatedRequest;
    const next = vi.fn() as unknown as NextFunction;

    machineAuth()(req, res, next);

    const suite = vi.mocked(checkApiKeyInner).mock.calls[0][2] as NextFunction;
    suite();

    expect(next).toHaveBeenCalledWith();
  });
});
