import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import authRoutes from './auth.routes';

// Hooks setup to mock the native behavior of Better-Auth
vi.mock('better-auth/node', () => ({
  toNodeHandler: vi.fn(() => {
    return (req: express.Request, res: express.Response) => {
      if (req.url === '/auth/sign-out' && req.method === 'POST') {
        res.status(200).json({ success: true });
        return;
      }

      if (req.url === '/auth/sign-in/email' && req.body?.password === 'wrong') {
        const err = new Error('UNAUTHORIZED') as Error & {
          status?: number;
          body?: { code?: string };
        };
        err.status = 401;
        err.body = { code: 'INVALID_EMAIL_OR_PASSWORD' };
        throw err;
      }

      res.status(200).json({ session: 'mocked' });
    };
  }),
}));

vi.mock('../../../shared/utils/checkApiKey/checkApiKey', () => ({
  checkApiKey: vi.fn(
    () => (req: express.Request, res: express.Response, next: express.NextFunction) => next()
  ),
}));

vi.mock('../middlewares/guardSignUp.middleware', () => ({
  requireInvitationOrFirstUser: vi.fn(
    (req: express.Request, res: express.Response, next: express.NextFunction) => next()
  ),
}));

// Global error handler mock
vi.mock('../../../shared/utils/errorHandler/errorHandler', () => ({
  handleError: vi.fn(
    (error: Error & { status?: number }, req: express.Request, res: express.Response) => {
      res.status(error.status || 500).json(error);
    }
  ),
}));

describe('Auth Routes Integration', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    app.use('/api', authRoutes);

    app.use(
      (
        err: Error & { status?: number },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => {
        res.status(err.status || 500).json(err);
      }
    );
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
