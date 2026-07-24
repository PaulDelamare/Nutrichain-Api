import { describe, it, expect, vi } from 'vitest';
import { Request, Response } from 'express';
import { allowAuthRoutes } from './allowAuthRoutes.middleware';
import { APIError } from '../../../shared/utils/errorHandler/APIError';

const invoke = (path: string, method = 'POST') => {
  const next = vi.fn();
  allowAuthRoutes({ path, method } as Request, {} as Response, next);
  return next.mock.calls[0]?.[0] as APIError | undefined;
};

describe('allowlist du passthrough Better-Auth', () => {
  // Les seuls flux réellement utilisés par le front et le mobile (audit des deux dépôts) : rien
  // d'autre ne doit passer, sinon on rouvre le passthrough hors RBAC et hors audit.
  it.each(['/auth/sign-in/email', '/auth/sign-up/email', '/auth/sign-out'])(
    'laisse passer %s en POST',
    (path) => {
      expect(invoke(path)).toBeUndefined();
    }
  );

  // Tout le reste du core Better-Auth : gestion utilisateur, sessions, reset MDP, 2FA.
  it.each([
    '/auth/delete-user',
    '/auth/update-user',
    '/auth/change-email',
    '/auth/change-password',
    '/auth/get-session',
    '/auth/list-sessions',
    '/auth/revoke-session',
    '/auth/revoke-sessions',
    '/auth/forget-password',
    '/auth/reset-password',
    '/auth/verify-email',
    '/auth/two-factor/enable',
    '/auth/two-factor/verify-totp',
    '/auth/n-importe-quoi-de-futur',
  ])('refuse %s en 403', (path) => {
    const error = invoke(path);
    expect(error).toBeInstanceOf(APIError);
    expect(error?.status).toBe(403);
  });

  // La méthode compte : un GET sur un chemin autorisé (sondage/énumération) ne passe pas.
  it('refuse un chemin autorisé avec la mauvaise méthode', () => {
    expect(invoke('/auth/sign-in/email', 'GET')?.status).toBe(403);
  });

  // Un chemin qui RESSEMBLE à un chemin autorisé ne doit pas passer par préfixe.
  it('refuse un chemin qui commence pareil sans être exactement autorisé', () => {
    expect(invoke('/auth/sign-in/email/steal')?.status).toBe(403);
    expect(invoke('/auth/sign-out-all')?.status).toBe(403);
  });
});
