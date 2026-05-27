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

describe('generateInvitation controller', () => {
  const activeOrgId = 'org_test_123';
  const inviterUser = { id: 'user_inviter', email: 'admin@test.local' };

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
});
