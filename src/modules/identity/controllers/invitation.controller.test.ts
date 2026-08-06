import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types/auth.types';

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
  render: vi.fn().mockResolvedValue('<html></html>'),
}));

vi.mock('../../../shared/utils/mailer/templates/InvitationEmail', () => ({
  InvitationEmail: () => null,
}));

import { generateInvitation } from './invitation.controller';
import { bdd } from '../../../shared/configs/prismaClient.config';
import { render } from '@react-email/render';

describe('generateInvitation controller', () => {
  const activeOrgId = 'org_test_123';
  const inviterUser = { id: 'user_inviter', email: 'admin@test.local', name: 'Alice Admin' };

  const buildReq = (
    body: Record<string, unknown> = { email: 'newbie@test.local', role: 'operator' }
  ): AuthenticatedRequest =>
    ({
      body,
      auth: {
        user: inviterUser,
        activeOrgId,
      },
    }) as unknown as AuthenticatedRequest;

  const buildRes = (): Response =>
    ({
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }) as unknown as Response;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(bdd.organization.findUnique).mockResolvedValue({
      id: activeOrgId,
      name: 'Test Org',
    } as never);
    vi.mocked(bdd.user.findUnique).mockResolvedValue(null);
    vi.mocked(bdd.invitation.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(bdd.invitation.create).mockImplementation((async ({
      data,
    }: {
      data: Record<string, unknown>;
    }) => ({ ...data })) as never);
  });

  it("doit créer l'invitation avec l'organizationId de la session active (Bug 1)", async () => {
    const req = buildReq();
    const res = buildRes();
    const next = vi.fn();

    await generateInvitation(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(bdd.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: activeOrgId,
          email: 'newbie@test.local',
          role: 'operator',
        }),
      })
    );
  });

  it("doit scoper deleteMany aux invitations de l'organisation active uniquement (Bug 3)", async () => {
    const req = buildReq();
    const res = buildRes();
    const next = vi.fn();

    await generateInvitation(req, res, next as unknown as NextFunction);

    expect(bdd.invitation.deleteMany).toHaveBeenCalledWith({
      where: {
        email: 'newbie@test.local',
        status: 'pending',
        organizationId: activeOrgId,
      },
    });
  });

  it("transmet le NOM de session au template, jamais l'e-mail de l'invitant (anti-fuite)", async () => {
    const req = buildReq();
    const res = buildRes();
    await generateInvitation(req, res, vi.fn() as unknown as NextFunction);

    // Prop reellement passee a React.createElement(InvitationEmail, { ... }).
    const element = vi.mocked(render).mock.calls[0][0] as { props: { inviterName?: unknown } };
    expect(element.props.inviterName).toBe(inviterUser.name);
    // Mutation : si le controller repassait auth.user.email, cette ligne rougit.
    expect(String(element.props.inviterName ?? '')).not.toContain('@');
  });
});
