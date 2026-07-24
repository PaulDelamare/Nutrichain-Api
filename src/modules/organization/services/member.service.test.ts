import { describe, it, expect, vi, beforeEach } from 'vitest';

const memberFindFirst = vi.fn();
const memberUpdate = vi.fn();
const memberDelete = vi.fn();
const invitationDeleteMany = vi.fn();
const sessionDeleteMany = vi.fn();
const logAction = vi.fn();

const tx = {
  member: { update: memberUpdate, delete: memberDelete },
  invitation: { deleteMany: invitationDeleteMany },
  session: { deleteMany: sessionDeleteMany },
};

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    member: { findFirst: (...a: unknown[]) => memberFindFirst(...a) },
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
  },
}));
vi.mock('../../../shared/utils/audit/audit.service', () => ({
  auditService: { logAction: (...a: unknown[]) => logAction(...a) },
}));

const { memberService } = await import('./member.service');

const ORG = 'org-1';
const ACTOR = 'admin-user'; // l'appelant
const member = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  userId: 'target-user',
  organizationId: ORG,
  role: 'operator',
  user: { email: 'target@x.fr' },
  ...over,
});

beforeEach(() => {
  [
    memberFindFirst,
    memberUpdate,
    memberDelete,
    invitationDeleteMany,
    sessionDeleteMany,
    logAction,
  ].forEach((m) => m.mockReset());
});

describe('memberService.changeRole', () => {
  it('change le rôle d’un membre et le journalise (ancien → nouveau)', async () => {
    memberFindFirst.mockResolvedValue(member({ role: 'operator' }));
    memberUpdate.mockResolvedValue(member({ role: 'quality' }));

    await memberService.changeRole('m1', 'quality', ORG, ACTOR);

    expect(memberUpdate).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { role: 'quality' } });
    const [params] = logAction.mock.calls[0];
    expect(params).toMatchObject({
      action: 'CHANGE_MEMBER_ROLE',
      organizationId: ORG,
      oldValue: { userId: 'target-user', role: 'operator' },
      newValue: { role: 'quality' },
    });
  });

  it("n'écrit rien si le rôle est déjà celui demandé (pas d'audit fantôme)", async () => {
    memberFindFirst.mockResolvedValue(member({ role: 'operator' }));

    await memberService.changeRole('m1', 'operator', ORG, ACTOR);

    expect(memberUpdate).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it("refuse de changer le rôle d'un membre d'une autre organisation (404)", async () => {
    memberFindFirst.mockResolvedValue(null);
    await expect(memberService.changeRole('x', 'quality', ORG, ACTOR)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("refuse de toucher un OWNER (coup d'État)", async () => {
    memberFindFirst.mockResolvedValue(member({ role: 'owner' }));
    await expect(memberService.changeRole('m1', 'admin', ORG, ACTOR)).rejects.toMatchObject({
      status: 403,
    });
    expect(memberUpdate).not.toHaveBeenCalled();
  });

  it('refuse de changer son PROPRE rôle (auto-verrouillage)', async () => {
    memberFindFirst.mockResolvedValue(member({ userId: ACTOR, role: 'admin' }));
    await expect(memberService.changeRole('m1', 'viewer', ORG, ACTOR)).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('memberService.revoke', () => {
  it('supprime le membre, annule ses invitations pending et ses sessions, dans une transaction', async () => {
    memberFindFirst.mockResolvedValue(member({ userId: 'target-user', role: 'operator' }));

    await memberService.revoke('m1', ORG, ACTOR);

    expect(memberDelete).toHaveBeenCalledWith({ where: { id: 'm1' } });
    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: 'target-user' } });
    expect(invitationDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'pending' }) })
    );
    const [params, passedTx] = logAction.mock.calls[0];
    expect(params).toMatchObject({
      action: 'REVOKE_MEMBER',
      oldValue: { userId: 'target-user', role: 'operator' },
    });
    expect(passedTx).toBe(tx); // audit dans la MÊME transaction
  });

  it('refuse de révoquer un OWNER', async () => {
    memberFindFirst.mockResolvedValue(member({ role: 'owner' }));
    await expect(memberService.revoke('m1', ORG, ACTOR)).rejects.toMatchObject({
      status: 403,
    });
    expect(memberDelete).not.toHaveBeenCalled();
  });

  it('refuse de se révoquer soi-même', async () => {
    memberFindFirst.mockResolvedValue(member({ userId: ACTOR }));
    await expect(memberService.revoke('m1', ORG, ACTOR)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("refuse un membre d'une autre organisation (404)", async () => {
    memberFindFirst.mockResolvedValue(null);
    await expect(memberService.revoke('x', ORG, ACTOR)).rejects.toMatchObject({
      status: 404,
    });
  });
});
