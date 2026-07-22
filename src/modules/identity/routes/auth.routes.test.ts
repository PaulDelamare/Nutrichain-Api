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

// Le verrou anti-bruteforce écrit en base : sans ce mock, ce fichier exigerait un PostgreSQL —
// il n'y en a pas en CI, et le test échouerait pour une raison sans rapport avec les routes.
const attemptUpsert = vi.fn();
const attemptUpdate = vi.fn();
const attemptDelete = vi.fn();
vi.mock('../../../shared/configs/prismaClient.config', () => {
  // Référence PARESSEUSE : `vi.mock` est hissé en haut du fichier, une capture directe des `vi.fn()`
  // ci-dessus échouerait à l'exécution de la factory.
  const loginAttempt = {
    upsert: (...a: unknown[]) => attemptUpsert(...a),
    update: (...a: unknown[]) => attemptUpdate(...a),
    deleteMany: (...a: unknown[]) => attemptDelete(...a),
  };
  return { prisma: { loginAttempt }, bdd: { loginAttempt } };
});

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

  beforeEach(() => {
    attemptUpsert.mockResolvedValue({
      email_hash: 'h',
      failed_count: 1,
      first_failed_at: new Date(),
      locked_until: null,
    });
    attemptUpdate.mockResolvedValue({});
    attemptDelete.mockResolvedValue({ count: 0 });
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

    /**
     * ⚠️ Ces deux cas verrouillent le CÂBLAGE. Les tests unitaires du middleware restent verts si
     * on le retire de la route — et une garde débranchée est exactement le défaut que cette PR
     * corrige (#145 venait déjà de là).
     */
    it('compte la tentative : le verrou par compte est bien branché sur la connexion', async () => {
      await request(app)
        .post('/api/auth/sign-in/email')
        .send({ email: 'test@example.com', password: 'wrong' });

      expect(attemptUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { failed_count: { increment: 1 } } })
      );
    });

    it('refuse en 429 quand le compte est verrouillé, sans atteindre Better-Auth', async () => {
      attemptUpsert.mockResolvedValue({
        email_hash: 'h',
        failed_count: 9,
        first_failed_at: new Date(),
        locked_until: new Date(Date.now() + 10 * 60 * 1000),
      });

      const res = await request(app)
        .post('/api/auth/sign-in/email')
        .send({ email: 'test@example.com', password: 'NutriChain!2026' });

      expect(res.status).toBe(429);
      expect(res.body.body.error[0].message).toMatch(/Trop de tentatives/);
    });
  });
});
