import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import authRoutes from './auth.routes';

// Hooks setup to mock the native behavior of Better-Auth
vi.mock('better-auth/node', () => ({
  toNodeHandler: vi.fn(() => {
    return (req: unknown, res: unknown) => {
      if (req.url === '/auth/sign-out' && req.method === 'POST') {
        res.status(200).json({ success: true });
        return;
      }

      if (req.url === '/auth/sign-in/email' && req.body?.password === 'wrong') {
        const APIErrorMock = Error as unknown;
        const err = new APIErrorMock('UNAUTHORIZED');
        err.status = 401;
        err.body = { code: 'INVALID_EMAIL_OR_PASSWORD' };
        throw err;
      }

      res.status(200).json({ session: 'mocked' });
    };
  }),
}));

vi.mock('../../../shared/utils/checkApiKey/checkApiKey', () => ({
  checkApiKey: vi.fn(() => (req: unknown, res: unknown, next: unknown) => next()),
}));

vi.mock('../middlewares/guardSignUp.middleware', () => ({
  requireInvitationOrFirstUser: vi.fn((req: unknown, res: unknown, next: unknown) => next()),
}));

// Global error handler mock
vi.mock('../../../shared/utils/errorHandler/errorHandler', () => ({
  handleError: vi.fn((error, req, res) => {
    res.status(error.status || 500).json(error);
  }),
}));

describe('Auth Routes Integration', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    app.use('/api', authRoutes);

    app.use((err: unknown, req: unknown, res: unknown, next: unknown) => {
      res.status(err.status || 500).json(err);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/auth/sign-out', () => {
    it('doit retourner une réponse 200 en cas de succès de la déconnexion', async () => {
      const res = await request(app).post('/api/auth/sign-out');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
    });
  });

  describe('POST /api/auth/sign-in/email', () => {
    it('doit bloquer et formater sur un mauvais mot de passe (via hook mock)', async () => {
      const res = await request(app)
        .post('/api/auth/sign-in/email')
        .send({ email: 'test@example.com', password: 'wrong' });

      expect(res.status).toBe(401);
      expect(res.body.error[0].message).toMatch(/Impossible de se connecter/);
    });
  });
});
