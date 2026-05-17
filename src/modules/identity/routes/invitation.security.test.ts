import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import invitationRoutes from './invitation.routes';
import { auth } from '../auth.config';

// 1. Mock de la configuration et des variables d'environnement
vi.mock('../auth.config', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
      getFullOrganization: vi.fn(),
    },
  },
}));

// Mock du contrÃ´leur pour l'Ã©tape de succÃ¨s ultime
vi.mock('../controllers/invitation.controller', () => ({
  generateInvitation: vi.fn((req, res) =>
    res.status(201).json({ status: 201, message: 'Success' })
  ),
}));

const VALID_API_KEY = 'TEST_SECRET_KEY';
process.env.API_KEY = VALID_API_KEY;

describe('Security & Validation E2E Scenarios (Invitations)', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    // Monter les routes sur /api comme dans l'app principale
    app.use('/api', invitationRoutes);

    // Error Handler minimum pour propager les erreurs catchAsync ou custom
    app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
      res.status(err.status || 500).json(err);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('ðŸ›¡ï¸ Couche 1 : VÃ©rification de la ClÃ© API (M2M / Frontend)', () => {
    it("doit refuser (401) si aucune clÃ© API n'est fournie", async () => {
      const res = await request(app)
        .post('/api/identity/invitations')
        .send({ email: 'test@nutrichain.local', role: 'operator', organizationId: '123' });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('clef API');
    });

    it('doit refuser (401) si une mauvaise clÃ© API est fournie', async () => {
      const res = await request(app)
        .post('/api/identity/invitations')
        .set('x-api-key', 'BAD_KEY')
        .send({ email: 'test@nutrichain.local', role: 'operator', organizationId: '123' });

      expect(res.status).toBe(401);
    });
  });

  describe('ðŸ” Couche 2 & 3 : Sessions Utilisateurs et Organisation (ABAC)', () => {
    it("doit refuser (401) si l'utilisateur n'est pas connectÃ© (Pas de session)", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null);

      const res = await request(app)
        .post('/api/identity/invitations')
        .set('x-api-key', VALID_API_KEY)
        .send({ email: 'test@nutrichain.local', role: 'operator', organizationId: '123' });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('AccÃ¨s refusÃ©. Veuillez vous authentifier.');
    });

    it("doit refuser (400) si l'utilisateur est connectÃ© MAIS n'a pas activÃ© d'Usine / Organisation", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue({
        session: { activeOrganizationId: null } as unknown,
        user: { id: 'user_1' } as unknown,
      });

      const res = await request(app)
        .post('/api/identity/invitations')
        .set('x-api-key', VALID_API_KEY)
        .send({ email: 'test@nutrichain.local', role: 'operator', organizationId: '123' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Organisation (Lieu) active');
    });

    it("doit refuser (403) si l'utilisateur est connectÃ© dans l'usine, mais a un grade trop faible (ex: member)", async () => {
      // Mock de session valide
      vi.mocked(auth.api.getSession).mockResolvedValue({
        session: { activeOrganizationId: 'org_123' } as unknown,
        user: { id: 'user_1' } as unknown,
      });

      // Mock de l'organisation : L'utilisateur est juste "member", mais la route exige "owner" ou "admin"
      vi.mocked(auth.api.getFullOrganization).mockResolvedValue({
        members: [{ userId: 'user_1', role: 'member' }],
      } as unknown);

      const res = await request(app)
        .post('/api/identity/invitations')
        .set('x-api-key', VALID_API_KEY)
        .send({ email: 'test@nutrichain.local', role: 'operator', organizationId: '123' });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Action refusÃ©e');
      expect(res.body.message).toContain('Requis: owner ou admin');
    });
  });

  describe('ðŸ“ Couche 4 : Validation des Endpoints (VineJS Fail Fast)', () => {
    beforeEach(() => {
      // Pour tester VineJS, il faut passer toutes les couches de sÃ©curitÃ© Auth
      vi.mocked(auth.api.getSession).mockResolvedValue({
        session: { activeOrganizationId: 'org_123' } as unknown,
        user: { id: 'user_1' } as unknown,
      });
      vi.mocked(auth.api.getFullOrganization).mockResolvedValue({
        members: [{ userId: 'user_1', role: 'admin' }], // RÃ´le lÃ©gitime
      } as unknown);
    });

    it('doit refuser (400) si le payload est vide (Champs manquants)', async () => {
      const res = await request(app)
        .post('/api/identity/invitations')
        .set('x-api-key', VALID_API_KEY)
        .send({}); // Body vide !

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      // On s'attend Ã  ce que VineJS rÃ¢le sur email, role, et organizationId
      const errorContent = JSON.stringify(res.body.error);
      expect(errorContent).toContain('email');
      expect(errorContent).toContain('role');
    });

    it("doit refuser (400) si l'email est invalide ou le format UUID incorrect", async () => {
      const res = await request(app)
        .post('/api/identity/invitations')
        .set('x-api-key', VALID_API_KEY)
        .send({
          email: 'mauvais_email_sans_arobase',
          role: 'operator',
          organizationId: 'mauvais_format_uuid',
        });

      expect(res.status).toBe(400);
      const errorContent = JSON.stringify(res.body.error);
      expect(errorContent).toContain('email'); // VineJS dÃ©tecte que ce n'est pas un email
      expect(errorContent).toContain('organizationId'); // VineJS dÃ©tecte la faute d'UUID
    });
  });

  describe('âœ… ScÃ©nario IdÃ©al : Le hacker/utilisateur fait tout parfaitement', () => {
    it("doit accorder l'accÃ¨s (201) si toutes les conditions de sÃ©curitÃ© + typages sont rÃ©unies", async () => {
      // 1. Session valide
      vi.mocked(auth.api.getSession).mockResolvedValue({
        session: { activeOrganizationId: 'org_123' } as unknown,
        user: { id: 'user_1' } as unknown,
      });
      // 2. RÃ´le autoritaire (Admin)
      vi.mocked(auth.api.getFullOrganization).mockResolvedValue({
        members: [{ userId: 'user_1', role: 'admin' }],
      } as unknown);

      // 3. Payload VineJS ValidÃ©
      const validUUID = '123e4567-e89b-12d3-a456-426614174000';

      const res = await request(app)
        .post('/api/identity/invitations')
        .set('x-api-key', VALID_API_KEY)
        .send({
          email: 'bon.email@usine.com',
          role: 'operator',
          organizationId: validUUID,
        });

      // Le contrÃ´leur final (mockÃ©) rÃ©pond 201
      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Success');
    });
  });
});
