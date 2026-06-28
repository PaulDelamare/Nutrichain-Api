import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const checkApiKeyInner = vi.fn();
const requireOrgRoleInner = vi.fn();

vi.mock('../utils/checkApiKey/checkApiKey', () => ({
  checkApiKey: vi.fn(() => checkApiKeyInner),
}));

vi.mock('../../modules/identity/middlewares/requireOrgRole.middleware', () => ({
  requireOrgRole: vi.fn(() => requireOrgRoleInner),
}));

import { mixedAuth } from './mixedAuth';
import { checkApiKey } from '../utils/checkApiKey/checkApiKey';
import { requireOrgRole } from '../../modules/identity/middlewares/requireOrgRole.middleware';

describe('mixedAuth', () => {
  const buildReq = (apiKey?: string): Request =>
    ({
      headers: apiKey ? { 'x-api-key': apiKey } : {},
    }) as Request;

  const res = {} as Response;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('doit déléguer à checkApiKey si x-api-key est présent (mode M2M)', () => {
    const next = vi.fn() as NextFunction;
    mixedAuth(['owner', 'admin'])(buildReq('any-key'), res, next);

    expect(checkApiKey).toHaveBeenCalled();
    expect(checkApiKeyInner).toHaveBeenCalledWith(expect.any(Object), res, expect.any(Function));
    expect(requireOrgRole).not.toHaveBeenCalled();
  });

  it('doit déléguer à requireOrgRole avec les rôles si pas de x-api-key (mode session)', () => {
    const allowedRoles = ['owner', 'admin'];
    const next = vi.fn() as NextFunction;
    mixedAuth(allowedRoles)(buildReq(), res, next);

    expect(requireOrgRole).toHaveBeenCalledWith(allowedRoles);
    expect(requireOrgRoleInner).toHaveBeenCalledWith(expect.any(Object), res, expect.any(Function));
    expect(checkApiKey).not.toHaveBeenCalled();
  });

  it('M2M : clé valide SANS organisation résolue → 401 (anti-fuite cross-tenant)', () => {
    checkApiKeyInner.mockImplementation((_req, _res, next) => next());
    const next = vi.fn() as NextFunction;

    mixedAuth(['admin'])(buildReq('any-key'), res, next);

    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ status: 401 });
  });

  it('M2M : clé valide AVEC organisation → laisse passer sans erreur', () => {
    checkApiKeyInner.mockImplementation((req, _res, next) => {
      req.activeOrgId = 'org-1';
      next();
    });
    const next = vi.fn() as NextFunction;

    mixedAuth(['admin'])(buildReq('any-key'), res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('Session : activeOrgId posé par requireOrgRole → laisse passer', () => {
    requireOrgRoleInner.mockImplementation((req, _res, next) => {
      req.activeOrgId = 'org-1';
      next();
    });
    const next = vi.fn() as NextFunction;

    mixedAuth(['admin'])(buildReq(), res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("propage une erreur d'authentification sans la masquer", () => {
    const authError = { status: 401, error: [{ field: 'api_key', message: 'invalide' }] };
    checkApiKeyInner.mockImplementation((_req, _res, next) => next(authError));
    const next = vi.fn() as NextFunction;

    mixedAuth(['admin'])(buildReq('bad'), res, next);

    expect(next).toHaveBeenCalledWith(authError);
  });
});
