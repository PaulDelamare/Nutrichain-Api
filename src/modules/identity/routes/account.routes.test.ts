import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import accountRoutes from './account.routes';
import { auth } from '../auth.config';
import { accountService } from '../services/account.service';
import { globalErrorHandler } from '../../../shared/utils/errorHandler/errorHandler';

vi.mock('../auth.config', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock('../services/account.service', () => ({
  accountService: { deleteMyAccount: vi.fn() },
}));

const VALID_API_KEY = 'TEST_SECRET_KEY';
process.env.API_KEY = VALID_API_KEY;

describe('DELETE /identity/me (câblage réel de la route)', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api', accountRoutes);
    app.use(globalErrorHandler);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("refuse (401) sans clé API, avant même d'atteindre l'authentification", async () => {
    const res = await request(app).delete('/api/identity/me');

    expect(res.status).toBe(401);
    expect(accountService.deleteMyAccount).not.toHaveBeenCalled();
  });

  it("refuse (401) sans session, une fois la clé API fournie", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    const res = await request(app).delete('/api/identity/me').set('x-api-key', VALID_API_KEY);

    expect(res.status).toBe(401);
    expect(accountService.deleteMyAccount).not.toHaveBeenCalled();
  });

  it("appelle réellement accountService.deleteMyAccount avec l'ID de la session, via le vrai routeur Express", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      session: { activeOrganizationId: 'org_123' } as unknown,
      user: { id: 'user_1' } as unknown,
    });
    vi.mocked(accountService.deleteMyAccount).mockResolvedValue(undefined);

    const res = await request(app).delete('/api/identity/me').set('x-api-key', VALID_API_KEY);

    expect(res.status).toBe(200);
    expect(accountService.deleteMyAccount).toHaveBeenCalledWith('user_1');
  });
});
