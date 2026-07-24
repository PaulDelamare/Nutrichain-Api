import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const requireOrgRoleInner = vi.fn();

vi.mock('../../modules/identity/middlewares/requireOrgRole.middleware', () => ({
  requireOrgRole: vi.fn(() => requireOrgRoleInner),
}));

import { sessionAuth } from './sessionAuth';
import { requireOrgRole } from '../../modules/identity/middlewares/requireOrgRole.middleware';
import { APIError } from '../utils/errorHandler/APIError';

describe('sessionAuth', () => {
  const buildReq = (headers: Record<string, string> = {}): Request =>
    ({ headers }) as unknown as Request;

  const res = {} as Response;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuse une clé API seule : elle n'autorise aucune action humaine", () => {
    // LE test qui manquait. Son absence a laissé passer ceci : la clé, compilée dans le bundle
    // mobile et commitée dans un dépôt public, permettait de créer des réceptions et de lire
    // l'annuaire nominatif des salariés — sans aucun compte.
    const next = vi.fn() as unknown as NextFunction;

    sessionAuth(['owner', 'admin'])(buildReq({ 'x-api-key': 'une-cle-valide' }), res, next);

    const error = vi.mocked(next).mock.calls[0][0] as APIError;
    expect(error).toBeInstanceOf(APIError);
    expect(error.status).toBe(401);
    // Et surtout : on n'a même pas consulté la clé. Sa validité n'entre pas en ligne de compte.
    expect(requireOrgRole).not.toHaveBeenCalled();
  });

  it('évalue TOUJOURS les rôles quand une session est présente', () => {
    const next = vi.fn() as unknown as NextFunction;

    sessionAuth(['owner'])(buildReq({ authorization: 'Bearer jeton' }), res, next);

    expect(requireOrgRole).toHaveBeenCalledWith(['owner']);
    expect(requireOrgRoleInner).toHaveBeenCalled();
  });

  it('évalue les rôles même quand la clé accompagne la session (cas du front SSR)', () => {
    // Le front envoie sa clé ET les cookies de session sur chaque requête. La session doit primer,
    // sinon l'organisation serait bornée à celle de la clé — chacun verrait les données d'une autre.
    const next = vi.fn() as unknown as NextFunction;

    sessionAuth(['quality'])(
      buildReq({ 'x-api-key': 'une-cle', cookie: 'better-auth.session_token=abc' }),
      res,
      next
    );

    expect(requireOrgRole).toHaveBeenCalledWith(['quality']);
    expect(next).not.toHaveBeenCalledWith(expect.any(APIError));
  });

  it('refuse une session sans organisation active (sinon Prisma ne filtre plus rien)', () => {
    const next = vi.fn() as unknown as NextFunction;
    const req = buildReq({ authorization: 'Bearer jeton' });

    sessionAuth(['owner'])(req, res, next);

    // requireOrgRole appelle son `next` : ici l'organisation n'a pas été résolue.
    const continuation = vi.mocked(requireOrgRoleInner).mock.calls[0][2] as NextFunction;
    continuation();

    const error = vi.mocked(next).mock.calls[0][0] as APIError;
    expect(error.status).toBe(401);
  });
});
