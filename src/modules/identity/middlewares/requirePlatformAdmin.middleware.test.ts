import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Response } from 'express';
import { AuthenticatedRequest } from '../types/auth.types';

const getSession = vi.fn();
const findUnique = vi.fn();

vi.mock('../auth.config', () => ({ auth: { api: { getSession: (...a: unknown[]) => getSession(...a) } } }));
vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: { platformAdmin: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}));

const { requirePlatformAdmin } = await import('./requirePlatformAdmin.middleware');

const run = async () => {
  const req = { headers: {} } as AuthenticatedRequest;
  const next = vi.fn();
  await requirePlatformAdmin(req, {} as Response, next);
  return { req, err: next.mock.calls[0]?.[0] as { status?: number } | undefined };
};

beforeEach(() => {
  getSession.mockReset();
  findUnique.mockReset();
});

describe('requirePlatformAdmin', () => {
  it('laisse passer un administrateur de plateforme, sans exiger d’organisation active', async () => {
    getSession.mockResolvedValue({ session: { id: 's' }, user: { id: 'u1' } });
    findUnique.mockResolvedValue({ id: 'pa1', userId: 'u1' });

    const { req, err } = await run();

    expect(err).toBeUndefined();
    expect(req.auth?.user.id).toBe('u1');
    // Il ne doit PAS avoir d'organisation active : c'est ce qui l'empêche d'atteindre le métier.
    expect(req.activeOrgId).toBeUndefined();
  });

  it('refuse un utilisateur authentifié qui n’est pas administrateur de plateforme', async () => {
    getSession.mockResolvedValue({ session: { id: 's' }, user: { id: 'u2' } });
    findUnique.mockResolvedValue(null);

    const { err } = await run();

    expect(err?.status).toBe(403);
  });

  it('refuse une requête sans session', async () => {
    getSession.mockResolvedValue(null);

    const { err } = await run();

    expect(err?.status).toBe(401);
    // On ne doit surtout pas interroger la table des admins sans session authentifiée.
    expect(findUnique).not.toHaveBeenCalled();
  });
});
