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
  const buildReq = (apiKey?: string, sessionHeaders: Record<string, string> = {}): Request =>
    ({
      headers: { ...(apiKey ? { 'x-api-key': apiKey } : {}), ...sessionHeaders },
    }) as unknown as Request;

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

  it('doit privilégier la session quand un Bearer accompagne la clé API', () => {
    // Les clients porteurs d'une session (mobile, front SSR) envoient aussi la clé API,
    // exigée par /api/auth/*. Basculer en M2M sur sa seule présence ignorerait l'utilisateur
    // et bornerait l'organisation à API_KEY_ORG_ID : chacun verrait les données d'une autre
    // organisation que la sienne.
    const next = vi.fn() as NextFunction;

    mixedAuth(['owner'])(buildReq('any-key', { authorization: 'Bearer jwt-123' }), res, next);

    expect(requireOrgRole).toHaveBeenCalledWith(['owner']);
    expect(checkApiKey).not.toHaveBeenCalled();
  });

  it('doit privilégier la session quand un cookie de session accompagne la clé API', () => {
    const next = vi.fn() as NextFunction;

    mixedAuth(['owner'])(
      buildReq('any-key', { cookie: 'better-auth.session_token=abc; theme=dark' }),
      res,
      next
    );

    expect(requireOrgRole).toHaveBeenCalledWith(['owner']);
    expect(checkApiKey).not.toHaveBeenCalled();
  });

  it('reste en M2M avec une clé API et des cookies non liés à une session', () => {
    // Un cookie quelconque ne doit pas priver une intégration machine de son mode d'auth.
    const next = vi.fn() as NextFunction;

    mixedAuth(['owner'])(buildReq('any-key', { cookie: 'theme=dark' }), res, next);

    expect(checkApiKey).toHaveBeenCalled();
    expect(requireOrgRole).not.toHaveBeenCalled();
  });

  it("propage une erreur d'authentification sans la masquer", () => {
    const authError = { status: 401, error: [{ field: 'api_key', message: 'invalide' }] };
    checkApiKeyInner.mockImplementation((_req, _res, next) => next(authError));
    const next = vi.fn() as NextFunction;

    mixedAuth(['admin'])(buildReq('bad'), res, next);

    expect(next).toHaveBeenCalledWith(authError);
  });
});
