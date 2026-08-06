import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  bdd: {
    organization: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    invitation: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('../../../shared/utils/mailer/mailer', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@react-email/render', () => ({
  render: vi.fn().mockResolvedValue('<html>invitation</html>'),
}));

vi.mock('../../../shared/utils/mailer/templates/InvitationEmail', () => ({
  InvitationEmail: () => null,
}));

import { render } from '@react-email/render';
import type { ReactElement } from 'react';
import { createAndSendInvitation } from './invitation.service';
import { bdd } from '../../../shared/configs/prismaClient.config';
import { sendEmail } from '../../../shared/utils/mailer/mailer';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { INVITATION_EXPIRATION_DAYS } from '../constants/roles.constants';

describe('createAndSendInvitation', () => {
  const params = {
    organizationId: 'org_cible_123',
    inviterId: 'user_inviter',
    inviterEmail: 'admin@test.local',
    email: 'newbie@test.local',
    role: 'operator',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks n'efface pas les implementations : on repose les valeurs par defaut ici.
    vi.mocked(bdd.organization.findUnique).mockResolvedValue({
      id: params.organizationId,
      name: 'Ferme du Test',
    } as never);
    // 1) invitee par email → null (pas de compte) ; 2) inviter par id → nom affiché.
    vi.mocked(bdd.user.findUnique).mockImplementation((async (args: {
      where: { email?: string; id?: string };
    }) => {
      if (args.where.email) return null;
      if (args.where.id === params.inviterId) {
        return { name: 'Alice Admin', email: params.inviterEmail };
      }
      return null;
    }) as never);
    vi.mocked(bdd.invitation.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(bdd.invitation.create).mockImplementation((async ({
      data,
    }: {
      data: Record<string, unknown>;
    }) => ({ ...data })) as never);
  });

  it("rejette en 404 quand l'organisation cible n'existe pas, sans creer ni envoyer", async () => {
    vi.mocked(bdd.organization.findUnique).mockResolvedValue(null);

    await expect(createAndSendInvitation(params)).rejects.toMatchObject({
      status: 404,
      body: { error: [{ field: 'organizationId' }] },
    });
    await expect(createAndSendInvitation(params)).rejects.toBeInstanceOf(APIError);

    expect(bdd.invitation.create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejette en 400 quand l'email possede deja un compte, sans creer ni envoyer", async () => {
    vi.mocked(bdd.user.findUnique).mockResolvedValue({
      id: 'user_existant',
      email: params.email,
    } as never);

    await expect(createAndSendInvitation(params)).rejects.toMatchObject({
      status: 400,
      body: { error: [{ field: 'email' }] },
    });

    expect(bdd.invitation.create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("purge uniquement les invitations pending de l'organisation cible ET de cet email", async () => {
    await createAndSendInvitation(params);

    expect(bdd.invitation.deleteMany).toHaveBeenCalledWith({
      where: {
        email: params.email,
        status: 'pending',
        organizationId: params.organizationId,
      },
    });
  });

  it("cree l'invitation avec l'organizationId passe en parametre, tel quel", async () => {
    await createAndSendInvitation(params);

    expect(bdd.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: params.organizationId,
          inviterId: params.inviterId,
          email: params.email,
          role: params.role,
          status: 'pending',
        }),
      })
    );
  });

  it("fixe l'expiration a INVITATION_EXPIRATION_DAYS jours et la renvoie", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-23T10:00:00.000Z'));

    const { expiresAt } = await createAndSendInvitation(params);

    const deltaDays = Math.round((expiresAt.getTime() - Date.now()) / 86_400_000);
    expect(deltaDays).toBe(INVITATION_EXPIRATION_DAYS);

    vi.useRealTimers();
  });

  it("envoie l'e-mail a l'invite, avec le nom de l'organisation dans le sujet", async () => {
    await createAndSendInvitation(params);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: params.email,
        subject: expect.stringContaining('Ferme du Test'),
        html: '<html>invitation</html>',
      })
    );
  });

  it("n'injecte jamais l'email de l'invitant dans le template — uniquement son nom", async () => {
    await createAndSendInvitation(params);

    const element = vi.mocked(render).mock.calls[0][0] as ReactElement<{
      inviterName?: string | null;
    }>;
    expect(element.props.inviterName).toBe('Alice Admin');
    expect(element.props.inviterName).not.toBe(params.inviterEmail);
  });

  it("omet le nom d'invitant si Better-Auth n'a stocké que l'email comme name", async () => {
    vi.mocked(bdd.user.findUnique).mockImplementation((async (args: {
      where: { email?: string; id?: string };
    }) => {
      if (args.where.email) return null;
      if (args.where.id === params.inviterId) {
        return { name: params.inviterEmail, email: params.inviterEmail };
      }
      return null;
    }) as never);

    await createAndSendInvitation(params);

    const element = vi.mocked(render).mock.calls[0][0] as ReactElement<{
      inviterName?: string | null;
    }>;
    expect(element.props.inviterName).toBeNull();
  });

  it("renvoie l'identifiant de l'invitation creee", async () => {
    const result = await createAndSendInvitation(params);

    const createdData = vi.mocked(bdd.invitation.create).mock.calls[0][0].data as {
      id: string;
    };
    expect(result.invitationId).toBe(createdData.id);
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
