import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notifyOrgAdmins } from './notifyOrgAdmins';
import { prisma } from '../../configs/prismaClient.config';
import { sendEmail } from './mailer';
import { logger } from '../logger/logger';

vi.mock('../../configs/prismaClient.config', () => ({
  prisma: { member: { findMany: vi.fn() } },
}));

vi.mock('./mailer', () => ({ sendEmail: vi.fn() }));

vi.mock('../logger/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

describe('notifyOrgAdmins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('résout les owner/admin de l organisation et envoie à chacun', async () => {
    vi.mocked(prisma.member.findMany).mockResolvedValue([
      { user: { email: 'a@x.fr', name: 'A' } },
      { user: { email: 'b@x.fr', name: 'B' } },
    ] as never);
    vi.mocked(sendEmail).mockResolvedValue(undefined as never);

    await notifyOrgAdmins('org-1', { subject: 'S', html: '<p>H</p>' });

    expect(prisma.member.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', role: { in: ['owner', 'admin'] } },
      })
    );
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail).toHaveBeenCalledWith({ to: 'a@x.fr', subject: 'S', html: '<p>H</p>' });
  });

  it('avale un échec d envoi sans interrompre les autres ni rejeter', async () => {
    vi.mocked(prisma.member.findMany).mockResolvedValue([
      { user: { email: 'a@x.fr', name: 'A' } },
      { user: { email: 'b@x.fr', name: 'B' } },
    ] as never);
    vi.mocked(sendEmail)
      .mockRejectedValueOnce(new Error('SMTP down'))
      .mockResolvedValue(undefined as never);

    await expect(notifyOrgAdmins('org-1', { subject: 'S', html: 'H' })).resolves.toBeUndefined();
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it('aucun destinataire → aucun envoi, pas d erreur', async () => {
    vi.mocked(prisma.member.findMany).mockResolvedValue([] as never);

    await expect(notifyOrgAdmins('org-1', { subject: 'S', html: 'H' })).resolves.toBeUndefined();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('cloisonne strictement les destinataires sur l organisation demandée', async () => {
    vi.mocked(prisma.member.findMany).mockResolvedValue([] as never);

    await notifyOrgAdmins('org-A', { subject: 'S', html: 'H' });

    expect(prisma.member.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-A', role: { in: ['owner', 'admin'] } },
      })
    );
  });

  it('avale une erreur de résolution des destinataires (findMany rejette) sans throw', async () => {
    vi.mocked(prisma.member.findMany).mockRejectedValue(new Error('DB down'));

    await expect(notifyOrgAdmins('org-1', { subject: 'S', html: 'H' })).resolves.toBeUndefined();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});
