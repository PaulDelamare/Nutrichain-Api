import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { globalErrorHandler } from '../../../shared/utils/errorHandler/errorHandler';

vi.mock('../../../shared/utils/checkApiKey/checkApiKey', () => ({
  checkApiKey: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}));

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  bdd: {
    invitation: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
    user: { findFirst: vi.fn() },
  },
  prisma: {},
}));

import invitationRouter from './invitation.routes';
import { bdd } from '../../../shared/configs/prismaClient.config';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api', invitationRouter);
  app.use(globalErrorHandler);
  return app;
};

describe('GET /identity/invitations/:token/preview (page inscription du front)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("200 : renvoie email/role/status/expiresAt dans l'enveloppe data", async () => {
    const expiresAt = new Date('2026-08-01T00:00:00.000Z');
    vi.mocked(bdd.invitation.findFirst).mockResolvedValue({
      email: 'invite@nutrichain.local',
      role: 'member',
      status: 'pending',
      expiresAt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const res = await request(buildApp()).get('/api/identity/invitations/inv-123/preview');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      email: 'invite@nutrichain.local',
      role: 'member',
      status: 'pending',
      expiresAt: expiresAt.toISOString(),
    });
    expect(bdd.invitation.findFirst).toHaveBeenCalledWith({
      where: { id: 'inv-123' },
      select: { email: true, role: true, status: true, expiresAt: true },
    });
  });

  it('404 : invitation inconnue → message français exploitable par le front', async () => {
    vi.mocked(bdd.invitation.findFirst).mockResolvedValue(null);

    const res = await request(buildApp()).get('/api/identity/invitations/inconnu/preview');

    expect(res.status).toBe(404);
    expect(res.body.error[0].field).toBe('token');
  });
});
