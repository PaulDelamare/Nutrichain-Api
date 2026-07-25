import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIError } from '../../../shared/utils/errorHandler/APIError';

const userFindUnique = vi.fn();
const memberFindUnique = vi.fn();
const userUpdate = vi.fn();
const sessionDeleteMany = vi.fn();
const accountDeleteMany = vi.fn();
const twoFactorDeleteMany = vi.fn();
const memberDelete = vi.fn();
const logAction = vi.fn();

const tx = {
  user: { update: userUpdate },
  session: { deleteMany: sessionDeleteMany },
  account: { deleteMany: accountDeleteMany },
  twoFactor: { deleteMany: twoFactorDeleteMany },
  member: { delete: memberDelete },
};

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    member: { findUnique: (...a: unknown[]) => memberFindUnique(...a) },
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
  },
}));
vi.mock('../../../shared/utils/audit/audit.service', () => ({
  auditService: { logAction: (...a: unknown[]) => logAction(...a) },
}));

const { accountService } = await import('./account.service');

const USER_ID = 'user-1';

beforeEach(() => {
  [
    userFindUnique,
    memberFindUnique,
    userUpdate,
    sessionDeleteMany,
    accountDeleteMany,
    twoFactorDeleteMany,
    memberDelete,
    logAction,
  ].forEach((m) => m.mockReset());
  userFindUnique.mockResolvedValue({ id: USER_ID, email: 'reel@x.fr', name: 'Vrai Nom' });
});

describe('accountService.deleteMyAccount', () => {
  it("échoue (404) si l'utilisateur n'existe pas", async () => {
    userFindUnique.mockResolvedValue(null);

    await expect(accountService.deleteMyAccount(USER_ID)).rejects.toBeInstanceOf(APIError);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("refuse (409) si l'utilisateur est encore propriétaire d'une organisation", async () => {
    memberFindUnique.mockResolvedValue({ id: 'm1', role: 'owner', organizationId: 'org-1' });

    await expect(accountService.deleteMyAccount(USER_ID)).rejects.toMatchObject({ status: 409 });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("anonymise l'e-mail et le nom, sans jamais exposer l'e-mail réel dans le remplacement", async () => {
    memberFindUnique.mockResolvedValue(null);

    await accountService.deleteMyAccount(USER_ID);

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: expect.objectContaining({
        name: 'Compte supprimé',
        image: null,
        emailVerified: false,
      }),
    });
    const newEmail = userUpdate.mock.calls[0][0].data.email as string;
    expect(newEmail).not.toContain('reel@x.fr');
    expect(newEmail).toContain(USER_ID);
  });

  it('coupe toute session, tout identifiant de connexion et le 2FA', async () => {
    memberFindUnique.mockResolvedValue(null);

    await accountService.deleteMyAccount(USER_ID);

    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    expect(accountDeleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    expect(twoFactorDeleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } });
  });

  it("retire le membre de son organisation (rôle non-owner) et journalise l'action", async () => {
    memberFindUnique.mockResolvedValue({ id: 'm1', role: 'operator', organizationId: 'org-1' });

    await accountService.deleteMyAccount(USER_ID);

    expect(memberDelete).toHaveBeenCalledWith({ where: { id: 'm1' } });
    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        userId: USER_ID,
        action: 'USER_ANONYMIZED',
        entity: 'User',
        entityId: USER_ID,
        oldValue: { email: 'reel@x.fr', name: 'Vrai Nom' },
      }),
      tx
    );
  });

  it("n'échoue pas et ne journalise rien pour un utilisateur sans organisation (compte plateforme)", async () => {
    memberFindUnique.mockResolvedValue(null);

    await accountService.deleteMyAccount(USER_ID);

    expect(memberDelete).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
    expect(userUpdate).toHaveBeenCalled();
  });
});
