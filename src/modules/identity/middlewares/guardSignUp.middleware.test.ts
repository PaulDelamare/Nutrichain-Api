import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { requireInvitationOrFirstUser } from './guardSignUp.middleware';
import { bdd } from '../../../shared/configs/prismaClient.config';
import { getValidatedInvitationId } from '../utils/signupInvitationContext';

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  bdd: {
    user: { count: vi.fn() },
    invitation: { findFirst: vi.fn() },
  },
}));

const buildReq = (body: Record<string, unknown>): Request => ({ body }) as unknown as Request;

const runGuard = async (body: Record<string, unknown>) => {
  const req = buildReq(body);
  const next = vi.fn();
  await requireInvitationOrFirstUser(req, {} as Response, next as NextFunction);
  return next;
};

const buildInvitation = (overrides: Partial<{ id: string; email: string }> = {}) => ({
  id: overrides.id ?? 'inv-abc',
  email: overrides.email ?? 'invited@nutrichain.local',
  status: 'pending',
  expiresAt: new Date(Date.now() + 86400_000),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireInvitationOrFirstUser', () => {
  it('rejette 400 si email manquant', async () => {
    vi.mocked(bdd.user.count).mockResolvedValue(0);

    const next = await runGuard({});

    const err = next.mock.calls[0][0];
    expect(err?.status).toBe(400);
    expect(err?.body?.error?.[0]?.field).toBe('email');
  });

  it("bypass first-user : userCount===0 → next() sans contrôle d'invitation", async () => {
    vi.mocked(bdd.user.count).mockResolvedValue(0);

    const next = await runGuard({ email: 'admin@nutrichain.local' });

    expect(next).toHaveBeenCalledWith();
    expect(bdd.invitation.findFirst).not.toHaveBeenCalled();
  });

  it('rejette 403 si token absent ET userCount > 0 (anti-downgrade)', async () => {
    vi.mocked(bdd.user.count).mockResolvedValue(5);
    vi.mocked(bdd.invitation.findFirst).mockResolvedValue(null);

    const next = await runGuard({ email: 'invited@nutrichain.local' });

    const err = next.mock.calls[0][0];
    expect(err?.status).toBe(403);
    expect(err?.body?.error?.[0]?.message).toContain('invitation valide');
    // Anti-timing : findFirst est appelé avec un UUID dummy pour égaliser le temps
    // par rapport aux branches "token bidon" et "email inconnu"
    expect(bdd.invitation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: '00000000-0000-0000-0000-000000000000' }),
      })
    );
  });

  it('invitation valide avec token correspondant à (id, email) → next()', async () => {
    vi.mocked(bdd.user.count).mockResolvedValue(5);
    vi.mocked(bdd.invitation.findFirst).mockResolvedValue(buildInvitation() as never);

    const next = await runGuard({ email: 'invited@nutrichain.local', token: 'inv-abc' });

    expect(next).toHaveBeenCalledWith();
    // findFirst doit filtrer par id ET email simultanément
    expect(bdd.invitation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'inv-abc',
          email: 'invited@nutrichain.local',
          status: 'pending',
          expiresAt: { gt: expect.any(Date) },
        }),
      })
    );
  });

  it('token correct mais email pour une autre invitation → 403', async () => {
    vi.mocked(bdd.user.count).mockResolvedValue(5);
    vi.mocked(bdd.invitation.findFirst).mockResolvedValue(null);

    const next = await runGuard({ email: 'other@nutrichain.local', token: 'inv-abc' });

    const err = next.mock.calls[0][0];
    expect(err?.status).toBe(403);
  });

  it('token bidon → 403', async () => {
    vi.mocked(bdd.user.count).mockResolvedValue(5);
    vi.mocked(bdd.invitation.findFirst).mockResolvedValue(null);

    const next = await runGuard({ email: 'invited@nutrichain.local', token: 'inv-XXX' });

    const err = next.mock.calls[0][0];
    expect(err?.status).toBe(403);
  });

  it('invitation expirée → 403 (filtre expiresAt > now exclut)', async () => {
    vi.mocked(bdd.user.count).mockResolvedValue(5);
    vi.mocked(bdd.invitation.findFirst).mockResolvedValue(null);

    const next = await runGuard({ email: 'invited@nutrichain.local', token: 'inv-abc' });

    const err = next.mock.calls[0][0];
    expect(err?.status).toBe(403);
    expect(bdd.invitation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ expiresAt: { gt: expect.any(Date) } }),
      })
    );
  });

  it("anti-enumeration : 'pas de token', 'token bidon' et 'email inconnu' renvoient le MÊME message", async () => {
    vi.mocked(bdd.user.count).mockResolvedValue(5);

    // Cas 1 : pas de token
    const next1 = await runGuard({ email: 'a@nutrichain.local' });
    const msg1 = next1.mock.calls[0][0]?.body?.error?.[0]?.message;

    // Cas 2 : token bidon
    vi.mocked(bdd.invitation.findFirst).mockResolvedValueOnce(null);
    const next2 = await runGuard({ email: 'a@nutrichain.local', token: 'inv-bidon' });
    const msg2 = next2.mock.calls[0][0]?.body?.error?.[0]?.message;

    // Cas 3 : email inconnu mais token techniquement valide en format
    vi.mocked(bdd.invitation.findFirst).mockResolvedValueOnce(null);
    const next3 = await runGuard({ email: 'unknown@nutrichain.local', token: 'inv-abc' });
    const msg3 = next3.mock.calls[0][0]?.body?.error?.[0]?.message;

    expect(msg1).toBe(msg2);
    expect(msg2).toBe(msg3);
  });

  it('token == empty string → traité comme absent → 403 (pas de fall-through silencieux)', async () => {
    vi.mocked(bdd.user.count).mockResolvedValue(5);
    vi.mocked(bdd.invitation.findFirst).mockResolvedValue(null);

    const next = await runGuard({ email: 'invited@nutrichain.local', token: '' });

    const err = next.mock.calls[0][0];
    expect(err?.status).toBe(403);
    // findFirst quand même appelé avec DUMMY_TOKEN (anti-timing)
    expect(bdd.invitation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: '00000000-0000-0000-0000-000000000000' }),
      })
    );
  });

  it("token n'est pas une string (type confusion) → traité comme absent", async () => {
    vi.mocked(bdd.user.count).mockResolvedValue(5);
    vi.mocked(bdd.invitation.findFirst).mockResolvedValue(null);

    const next = await runGuard({ email: 'invited@nutrichain.local', token: 12345 });

    const err = next.mock.calls[0][0];
    expect(err?.status).toBe(403);
    // findFirst quand même appelé avec DUMMY_TOKEN (anti-timing)
    expect(bdd.invitation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: '00000000-0000-0000-0000-000000000000' }),
      })
    );
  });

  it("transmet l'invitation VALIDÉE au hook d'enrôlement", async () => {
    // Le hook ne reçoit que l'utilisateur : sans ce contexte, il re-cherchait par e-mail et
    // pouvait enrôler l'utilisateur dans l'organisation d'une AUTRE invitation en attente (#95).
    vi.mocked(bdd.user.count).mockResolvedValue(5);
    vi.mocked(bdd.invitation.findFirst).mockResolvedValue(
      buildInvitation({ id: 'inv-de-org-a' }) as never
    );

    let seenByHook: string | undefined;
    const req = buildReq({ email: 'invited@nutrichain.local', token: 'inv-de-org-a' });
    await requireInvitationOrFirstUser(req, {} as Response, (() => {
      seenByHook = getValidatedInvitationId();
    }) as NextFunction);

    expect(seenByHook).toBe('inv-de-org-a');
  });

  it('ne transmet aucune invitation au bootstrap du premier utilisateur', async () => {
    vi.mocked(bdd.user.count).mockResolvedValue(0);

    let seenByHook: string | undefined = 'valeur-parasite';
    const req = buildReq({ email: 'premier@nutrichain.local' });
    await requireInvitationOrFirstUser(req, {} as Response, (() => {
      seenByHook = getValidatedInvitationId();
    }) as NextFunction);

    // Sans invitation, le hook doit bien retomber sur la création d'organisation.
    expect(seenByHook).toBeUndefined();
  });
});
