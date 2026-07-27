import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { sanitizeRequestData } from './sanitizeData.middleware';

/**
 * #245 — Ce middleware est monté globalement (`apiConfigMiddleware.config.ts`), donc AVANT
 * `app.use('/api', authRoutes)` : les corps de `sign-up/email`, `sign-in/email`,
 * `change-password` et `reset-password` le traversent tous.
 *
 * Le test du niveau utilitaire couvre déjà la fonction ; celui-ci couvre le CHEMIN réel — c'est lui
 * qui rougirait si quelqu'un remontait le middleware, changeait son appel, ou réintroduisait
 * l'assainissement sur le corps entier.
 */
function requete(body: Record<string, unknown>): Request {
  return { body, query: {}, params: {} } as unknown as Request;
}

const reponse = {} as Response;

describe('sanitizeRequestData', () => {
  it('laisse le mot de passe traverser octet pour octet', () => {
    const req = requete({ email: 'op@nutrichain.local', password: 'abc<def>123&456' });
    const next = vi.fn();

    sanitizeRequestData(req, reponse, next);

    expect(req.body.password).toBe('abc<def>123&456');
    expect(next).toHaveBeenCalledOnce();
  });

  it('assainit les autres champs du même corps', () => {
    // L'exemption doit être chirurgicale : `name` est rendu dans l'interface, il reste assaini.
    const req = requete({ name: '<script>alert(1)</script>Olivia', password: 'a<b>c' });

    sanitizeRequestData(req, reponse, vi.fn());

    expect(req.body.name).toBe('Olivia');
    expect(req.body.password).toBe('a<b>c');
  });

  it('applique la même exemption à la famille des mots de passe', () => {
    const req = requete({ currentPassword: 'x<y>1', newPassword: 'z&w2' });

    sanitizeRequestData(req, reponse, vi.fn());

    expect(req.body.currentPassword).toBe('x<y>1');
    expect(req.body.newPassword).toBe('z&w2');
  });
});
