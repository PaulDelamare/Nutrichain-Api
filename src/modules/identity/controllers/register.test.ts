import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

describe('Authentication Routes Integrations (Better-Auth)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('devrait mapper toutes les routes vers better-auth /api/auth/*', async () => {
    // Simuler le fichier config
    vi.doMock('../auth.config', () => ({
      auth: {
        api: {},
      },
    }));

    // Simuler toNodeHandler pour vérifier que les routes express sont liées à Better Auth
    vi.doMock('better-auth/node', () => ({
      toNodeHandler: vi.fn().mockImplementation((authInstance) => {
        return (req: unknown, res: unknown) =>
          res.status(200).json({ ok: true, module: 'better-auth-mock' });
      }),
    }));

    vi.doMock('../middlewares/guardSignUp.middleware', () => ({
      requireInvitationOrFirstUser: (req: unknown, res: unknown, next: unknown) => next(),
    }));

    const { default: authRoutes } = await import('../routes/auth.routes');
    const app = express();

    app.use(express.json()); // Simulate global body parser

    // Comme dans src/app.ts
    app.use('/api', authRoutes);

    // Envoyer une requête POST sign-up normalisée
    const res = await request(app)
      .post('/api/auth/sign-up/email')
      .set('x-api-key', process.env.API_KEY || 'default-api-key')
      .send({
        email: 'test@nutrichain.com',
        password: 'StrongPassw0rd!123',
        name: 'Test User',
      });

    // Si Better Auth est frappé, il renvoie notre simulation
    expect(res.status).toBe(200);
    expect(res.body.module).toBe('better-auth-mock');
  });
});
