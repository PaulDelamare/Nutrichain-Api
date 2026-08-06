import { describe, it, expect, vi, beforeEach } from 'vitest';

const orgCreate = vi.fn();
const orgFindUnique = vi.fn();
const orgFindMany = vi.fn();
const memberCount = vi.fn();
const invitationCount = vi.fn();
const logAction = vi.fn();
const createAndSendInvitation = vi.fn();

const tx = { organization: { create: orgCreate }, member: { count: memberCount } };
const prisma = {
  organization: { findUnique: orgFindUnique, findMany: orgFindMany },
  member: { count: memberCount },
  invitation: { count: invitationCount },
  $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
};

vi.mock('@prisma/client', () => ({
  Prisma: {
    PrismaClientKnownRequestError: class extends Error {
      code: string;
      constructor(code: string) {
        super('prisma');
        this.code = code;
      }
    },
  },
}));

vi.mock('../../../shared/configs/prismaClient.config', () => ({ prisma }));
vi.mock('../../../shared/utils/audit/audit.service', () => ({
  auditService: { logAction: (...a: unknown[]) => logAction(...a) },
}));
vi.mock('../../identity/services/invitation.service', () => ({
  createAndSendInvitation: (...a: unknown[]) => createAndSendInvitation(...a),
}));

const { platformService } = await import('./platform.service');

beforeEach(() => {
  [
    orgCreate,
    orgFindUnique,
    orgFindMany,
    memberCount,
    invitationCount,
    logAction,
    createAndSendInvitation,
  ].forEach((m) => m.mockReset());
  invitationCount.mockResolvedValue(0);
});

describe('platformService.createOrganization', () => {
  it("crée l'organisation ET la journalise dans SA PROPRE chaîne d'audit, en une transaction", async () => {
    orgCreate.mockResolvedValue({ id: 'org-1', name: 'Ferme Bio', slug: 'ferme-bio' });

    const res = await platformService.createOrganization(
      { name: 'Ferme Bio', slug: 'ferme-bio' },
      'admin-plateforme'
    );

    expect(res.id).toBe('org-1');
    // L'audit est chaîné par organisation : la création est la 1re ligne de la chaîne de l'org née.
    expect(logAction).toHaveBeenCalledOnce();
    const [params, passedTx] = logAction.mock.calls[0];
    expect(params.organizationId).toBe('org-1');
    expect(params.action).toBe('CREATE_ORGANIZATION');
    expect(params.userId).toBe('admin-plateforme');
    // Dans la MÊME transaction que le create : sinon un audit sans org (rollback) ou une org sans trace.
    expect(passedTx).toBe(tx);
  });

  it('rejette un slug déjà pris en 409, plutôt qu’une erreur Prisma brute', async () => {
    orgFindUnique.mockResolvedValue({ id: 'x', slug: 'ferme-bio' });

    await expect(
      platformService.createOrganization({ name: 'Autre', slug: 'ferme-bio' }, 'admin')
    ).rejects.toMatchObject({ status: 409 });

    expect(orgCreate).not.toHaveBeenCalled();
  });

  it('traduit une collision CONCURRENTE (P2002) en 409, pas en 500', async () => {
    // Le slug est libre au pré-check, mais une transaction concurrente le prend avant le create.
    orgFindUnique.mockResolvedValue(null);
    const { Prisma } = await import('@prisma/client');
    orgCreate.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('P2002'));

    await expect(
      platformService.createOrganization({ name: 'Course', slug: 'course' }, 'admin')
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('platformService.inviteOwner', () => {
  it('invite le premier owner d’une organisation existante', async () => {
    orgFindUnique.mockResolvedValue({ id: 'org-1', name: 'Ferme Bio' });
    memberCount.mockResolvedValue(0);
    createAndSendInvitation.mockResolvedValue({ invitationId: 'inv-1', expiresAt: new Date() });

    const res = await platformService.inviteOwner('org-1', 'chef@ferme.fr', {
      id: 'admin',
      name: 'Admin Plateforme',
    });

    expect(res.invitationId).toBe('inv-1');
    const [params] = createAndSendInvitation.mock.calls[0];
    expect(params.organizationId).toBe('org-1');
    expect(params.role).toBe('owner');
    // Anti-fuite : on transmet le NOM de l'admin plateforme au template, jamais son email.
    expect(params.inviterName).toBe('Admin Plateforme');
    expect(String(params.inviterName ?? '')).not.toContain('@');
  });

  it('refuse d’inviter un owner sur une organisation qui en a déjà un membre', async () => {
    orgFindUnique.mockResolvedValue({ id: 'org-1' });
    memberCount.mockResolvedValue(1);

    await expect(
      platformService.inviteOwner('org-1', 'chef@ferme.fr', { id: 'a', name: 'Admin' })
    ).rejects.toMatchObject({ status: 409 });

    expect(createAndSendInvitation).not.toHaveBeenCalled();
  });

  it('refuse un 2e owner quand une invitation d’owner est déjà en attente', async () => {
    orgFindUnique.mockResolvedValue({ id: 'org-1' });
    memberCount.mockResolvedValue(0);
    invitationCount.mockResolvedValue(1); // un owner déjà invité, pas encore accepté

    await expect(
      platformService.inviteOwner('org-1', 'autre@ferme.fr', { id: 'a', name: 'Admin' })
    ).rejects.toMatchObject({ status: 409 });

    expect(createAndSendInvitation).not.toHaveBeenCalled();
  });

  it('refuse sur une organisation inexistante', async () => {
    orgFindUnique.mockResolvedValue(null);

    await expect(
      platformService.inviteOwner('inconnue', 'x@y.z', { id: 'a', name: 'Admin' })
    ).rejects.toMatchObject({ status: 404 });
  });
});
