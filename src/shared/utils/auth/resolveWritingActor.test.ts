import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveWritingActor } from './resolveWritingActor';
import { prisma } from '../../configs/prismaClient.config';
import { APIError } from '../errorHandler/APIError';

vi.mock('../../configs/prismaClient.config', () => ({
  prisma: { member: { findFirst: vi.fn() } },
}));

const ORG = 'org-1';
const ROLES = ['owner', 'admin', 'operator'];

beforeEach(() => vi.clearAllMocks());

describe('resolveWritingActor', () => {
  it('la session fait foi : le corps de la requête est ignoré', async () => {
    const actor = await resolveWritingActor({
      sessionUserId: 'user-session',
      actorUserId: 'user-usurpe',
      organizationId: ORG,
      allowedRoles: ROLES,
    });

    expect(actor).toBe('user-session');
    // Aucune vérification d'appartenance nécessaire : mixedAuth a déjà authentifié la session.
    expect(prisma.member.findFirst).not.toHaveBeenCalled();
  });

  it('refuse un acteur qui n’est PAS membre de l’organisation (falsification d’identité)', async () => {
    vi.mocked(prisma.member.findFirst).mockResolvedValue(null);

    await expect(
      resolveWritingActor({
        actorUserId: 'user-autre-org',
        organizationId: ORG,
        allowedRoles: ROLES,
      })
    ).rejects.toThrow(APIError);
  });

  it('accepte un acteur membre de l’organisation avec un rôle autorisé', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.member.findFirst).mockResolvedValue({ id: 'member-1' } as any);

    const actor = await resolveWritingActor({
      actorUserId: 'user-operateur',
      organizationId: ORG,
      allowedRoles: ROLES,
    });

    expect(actor).toBe('user-operateur');
    expect(prisma.member.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-operateur',
          organizationId: ORG,
          role: { in: ROLES },
        }),
      })
    );
  });

  it('exige un acteur en M2M : sans session ni acteur déclaré, on refuse', async () => {
    await expect(resolveWritingActor({ organizationId: ORG, allowedRoles: ROLES })).rejects.toThrow(
      APIError
    );
  });

  it('n’impose AUCUN format d’identifiant : les comptes existants ne sont pas des UUID', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.member.findFirst).mockResolvedValue({ id: 'member-1' } as any);

    const legacyId = 'Qx7pL2mN9vB3kR8sT1wY6zA4cD5eF0gH';

    await expect(
      resolveWritingActor({ actorUserId: legacyId, organizationId: ORG, allowedRoles: ROLES })
    ).resolves.toBe(legacyId);
  });
});
