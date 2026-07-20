import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { validateRecall } from './validateRecall.middleware';
import type { AuthenticatedRequest } from '../../../identity/types/auth.types';

const UUID = '11111111-1111-4111-8111-111111111111';

const run = async (params: Record<string, unknown>, body: unknown) => {
  const req = { params, body } as unknown as Request;
  const next = vi.fn();
  await validateRecall(req, {} as Response, next);
  return { req: req as AuthenticatedRequest, next };
};

describe('validateRecall — le rappel ne part plus sans motif validé', () => {
  it('motif valide + id UUID → next(), payload nettoyé (trim)', async () => {
    const { req, next } = await run({ id: UUID }, { reason: '  Listeria détectée sur le lot  ' });

    expect(next).toHaveBeenCalledWith(); // sans erreur
    expect(req.validatedRecall).toEqual({ id: UUID, reason: 'Listeria détectée sur le lot' });
  });

  it('motif non-chaîne (objet) → 400, jamais transmis au service', async () => {
    // C'était le bug : un objet passait le `if (!reason)`, puis cassait la requête SQL (rollback →
    // rappel non exécuté) ou donnait « [object Object] » dans l'e-mail client.
    const { next } = await run({ id: UUID }, { reason: { evil: true } });

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
  });

  it('motif trop court → 400', async () => {
    const { next } = await run({ id: UUID }, { reason: 'x' });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
  });

  it('id non-UUID → 400 (plus de 500 Prisma)', async () => {
    const { next } = await run({ id: 'pas-un-uuid' }, { reason: 'Motif parfaitement valide' });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
  });
});
