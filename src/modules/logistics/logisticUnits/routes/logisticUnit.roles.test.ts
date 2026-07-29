import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const getSession = vi.fn();
const getFullOrganization = vi.fn();

// On exerce le VRAI `sessionAuth`/`requireOrgRole` : c'est la liste des rôles autorisés qu'on
// teste, et le fait que les middlewares soient réellement MONTÉS sur la route. Un test de schéma
// ne prouve pas le câblage — plusieurs gardes de ce dépôt étaient écrites mais jamais branchées.
vi.mock('../../../identity/auth.config', () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSession(...args),
      getFullOrganization: (...args: unknown[]) => getFullOrganization(...args),
    },
  },
}));

vi.mock('../controllers/logisticUnit.controller', () => ({
  createLogisticUnitController: (_req: express.Request, res: express.Response) =>
    res.status(201).end(),
  resolveLogisticUnitController: (_req: express.Request, res: express.Response) =>
    res.status(200).end(),
  moveLogisticUnitController: (_req: express.Request, res: express.Response) =>
    res.status(200).end(),
}));

const { default: logisticUnitRoutes } = await import('./logisticUnit.routes');
const { globalErrorHandler } = await import('../../../../shared/utils/errorHandler/errorHandler');

const app = express();
app.use(express.json());
app.use('/api', logisticUnitRoutes);
app.use(globalErrorHandler);

function signedInAs(role: string): void {
  getSession.mockResolvedValue({
    user: { id: 'u-1' },
    session: { activeOrganizationId: 'org-1' },
  });
  getFullOrganization.mockResolvedValue({ id: 'org-1', members: [{ userId: 'u-1', role }] });
}

const VALID_SSCC = '380123400000000428';
const payload = { items: [{ id_lot: '11111111-1111-4111-8111-111111111111', quantite: 10 }] };

beforeEach(() => vi.clearAllMocks());

describe('RBAC et câblage des routes de palette', () => {
  describe('POST /logistics/logistic-units (constitution — geste terrain)', () => {
    it.each(['owner', 'admin', 'operator'])('autorise %s', async (role) => {
      signedInAs(role);
      const res = await request(app).post('/api/logistics/logistic-units').send(payload);
      expect(res.status).toBe(201);
    });

    it('refuse viewer (lecture seule)', async () => {
      signedInAs('viewer');
      const res = await request(app).post('/api/logistics/logistic-units').send(payload);
      expect(res.status).toBe(403);
    });

    it('refuse quality : palettiser est de la manutention, pas une décision qualité', async () => {
      signedInAs('quality');
      const res = await request(app).post('/api/logistics/logistic-units').send(payload);
      expect(res.status).toBe(403);
    });

    it('refuse (401) sans session', async () => {
      getSession.mockResolvedValue(null);
      const res = await request(app).post('/api/logistics/logistic-units').send(payload);
      expect(res.status).toBe(401);
    });

    // Preuve que la validation est MONTÉE, pas seulement écrite : sans elle, une liste vide
    // atteindrait le service et créerait une palette qui ne porte rien.
    it('refuse (400) une palette sans aucun lot', async () => {
      signedInAs('operator');
      const res = await request(app).post('/api/logistics/logistic-units').send({ items: [] });
      expect(res.status).toBe(400);
    });

    it('refuse (400) au-delà du plafond de lots', async () => {
      signedInAs('operator');
      const items = Array.from({ length: 101 }, () => ({
        id_lot: '11111111-1111-4111-8111-111111111111',
        quantite: 1,
      }));
      const res = await request(app).post('/api/logistics/logistic-units').send({ items });
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /logistics/logistic-units/:id/location (ranger — geste terrain)', () => {
    const body = { id_materiel: '22222222-2222-4222-8222-222222222222' };

    it.each(['owner', 'admin', 'operator'])('autorise %s', async (role) => {
      signedInAs(role);
      const res = await request(app)
        .patch('/api/logistics/logistic-units/palette-1/location')
        .send(body);
      expect(res.status).toBe(200);
    });

    it('refuse viewer (lecture seule)', async () => {
      signedInAs('viewer');
      const res = await request(app)
        .patch('/api/logistics/logistic-units/palette-1/location')
        .send(body);
      expect(res.status).toBe(403);
    });

    it('refuse (401) sans session', async () => {
      getSession.mockResolvedValue(null);
      const res = await request(app)
        .patch('/api/logistics/logistic-units/palette-1/location')
        .send(body);
      expect(res.status).toBe(401);
    });

    // Preuve que la validation est MONTÉE : sans elle, un emplacement absent atteindrait le service.
    it('refuse (400) sans emplacement de destination', async () => {
      signedInAs('operator');
      const res = await request(app)
        .patch('/api/logistics/logistic-units/palette-1/location')
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /logistics/logistic-units/by-sscc/:sscc (scan)', () => {
    it.each(['owner', 'admin', 'quality', 'operator', 'viewer'])(
      'autorise %s en lecture',
      async (role) => {
        signedInAs(role);
        const res = await request(app).get(
          `/api/logistics/logistic-units/by-sscc/${VALID_SSCC}`
        );
        expect(res.status).toBe(200);
      }
    );

    it('refuse (401) sans session', async () => {
      getSession.mockResolvedValue(null);
      const res = await request(app).get(`/api/logistics/logistic-units/by-sscc/${VALID_SSCC}`);
      expect(res.status).toBe(401);
    });

    it('refuse (400) un code qui n’a pas la forme d’un SSCC', async () => {
      signedInAs('operator');
      const res = await request(app).get('/api/logistics/logistic-units/by-sscc/3401234567890');
      expect(res.status).toBe(400);
    });

    it('accepte la lecture qui a conservé le préfixe d’AI 00 (20 caractères)', async () => {
      signedInAs('operator');
      const res = await request(app).get(
        `/api/logistics/logistic-units/by-sscc/00${VALID_SSCC}`
      );
      expect(res.status).toBe(200);
    });
  });
});
