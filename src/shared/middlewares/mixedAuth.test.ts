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
  const next = vi.fn() as NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('doit déléguer à checkApiKey si x-api-key est présent (mode M2M)', () => {
    const middleware = mixedAuth(['owner', 'admin']);

    middleware(buildReq('any-key'), res, next);

    expect(checkApiKey).toHaveBeenCalled();
    expect(checkApiKeyInner).toHaveBeenCalledWith(expect.any(Object), res, next);
    expect(requireOrgRole).not.toHaveBeenCalled();
  });

  it('doit déléguer à requireOrgRole avec les rôles autorisés si pas de x-api-key (mode session)', () => {
    const allowedRoles = ['owner', 'admin'];
    const middleware = mixedAuth(allowedRoles);

    middleware(buildReq(), res, next);

    expect(requireOrgRole).toHaveBeenCalledWith(allowedRoles);
    expect(requireOrgRoleInner).toHaveBeenCalledWith(expect.any(Object), res, next);
    expect(checkApiKey).not.toHaveBeenCalled();
  });
});
