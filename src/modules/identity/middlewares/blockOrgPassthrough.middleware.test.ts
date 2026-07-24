import { describe, it, expect, vi } from 'vitest';
import { Request, Response } from 'express';
import { blockOrgPassthrough } from './blockOrgPassthrough.middleware';
import { APIError } from '../../../shared/utils/errorHandler/APIError';

const invoke = (path: string) => {
  const next = vi.fn();
  blockOrgPassthrough({ path } as Request, {} as Response, next);
  return next.mock.calls[0]?.[0] as APIError | undefined;
};

describe('blocage du passthrough Better-Auth sur les organisations', () => {
  // Un viewer (lecture seule) créait une organisation et s'en faisait owner, sans passer par
  // notre RBAC ni laisser de trace dans l'audit WORM. Vérifié en HTTP réel avant correctif.
  it.each([
    '/auth/organization/create',
    '/auth/organization/delete',
    '/auth/organization/update',
    '/auth/organization/set-active',
    '/auth/organization/invite-member',
    '/auth/organization/remove-member',
    '/auth/organization/update-member-role',
    '/auth/organization/leave',
    '/auth/organization/create-role',
    '/auth/organization/list',
    '/auth/organization/n-importe-quoi-de-futur',
  ])('refuse %s en 403', (path) => {
    const error = invoke(path);

    expect(error).toBeInstanceOf(APIError);
    expect(error?.status).toBe(403);
  });

  // Le reste de Better-Auth (connexion, inscription, MFA, session) doit continuer de passer :
  // c'est notre seul mécanisme d'authentification.
  it.each([
    '/auth/sign-in/email',
    '/auth/sign-up/email',
    '/auth/sign-out',
    '/auth/get-session',
    '/auth/two-factor/enable',
  ])('laisse passer %s', (path) => {
    expect(invoke(path)).toBeUndefined();
  });

  // Un préfixe qui RESSEMBLE ne doit pas être bloqué par accident, et surtout un chemin
  // détourné ne doit pas contourner le blocage.
  it('ne bloque pas une route qui commence pareil sans être une route organisation', () => {
    expect(invoke('/auth/organizations-publiques')).toBeUndefined();
  });
});
