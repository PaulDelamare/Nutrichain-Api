import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import { app } from '../../../app';
import { syncScansService } from '../services/syncScans.service';

// Mock mixedAuth qui mime le vrai comportement :
// - x-api-key présent → M2M (pas de session user)
// - sinon              → session OPERATOR
vi.mock('../../../shared/middlewares/mixedAuth', () => ({
  mixedAuth: vi.fn(() => (req: Request, _res: Response, next: NextFunction) => {
    if (req.headers['x-api-key']) {
      Object.assign(req, {
        activeOrgId: 'org_test_123',
        auth: { activeOrgId: 'org_test_123' },
      });
    } else {
      Object.assign(req, {
        activeOrgId: 'org_test_123',
        auth: {
          user: { id: 'u-session', email: 'op@nutrichain.local' },
          activeOrgId: 'org_test_123',
          role: 'logistics_operator',
          session: { activeOrganizationId: 'org_test_123' },
        },
      });
    }
    next();
  }),
}));

vi.mock('../services/syncScans.service', () => ({
  syncScansService: { syncScans: vi.fn() },
}));

// Mock prisma (auth.config l'importe au chargement de l'app)
vi.mock('../../../shared/configs/prismaClient.config', () => {
  const mock = {
    receipt: { findFirst: vi.fn() },
    batch: { findFirst: vi.fn() },
  };
  return { prisma: mock, bdd: mock };
});

const validReceiptPayload = {
  id_fournisseur: '123e4567-e89b-12d3-a456-426614174000',
  shipment_id: 'SHIP-001',
  id_produit: '123e4567-e89b-12d3-a456-426614174001',
  quantite_actuelle: 100,
  unite_code: 'KG',
  statut_controle: 'OK',
};
const validItem = {
  clientOpId: '550e8400-e29b-41d4-a716-446655440000',
  type: 'receipt',
  payload: validReceiptPayload,
};

const successResponse = {
  results: [
    {
      clientOpId: validItem.clientOpId,
      status: 'ok',
      serverId: { receiptId: 'rcpt-1', batchId: 'bat-1' },
    },
  ],
  summary: { total: 1, ok: 1, error: 0, conflict: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(syncScansService.syncScans).mockResolvedValue(successResponse);
});

describe('Sync Routes — POST /api/sync/scans', () => {
  describe('Session mode (web/mobile)', () => {
    it('retourne 207 et passe sessionUserId au service', async () => {
      const res = await request(app)
        .post('/api/sync/scans')
        .send({ items: [validItem] });

      expect(res.status).toBe(207);
      expect(res.body.data.summary.ok).toBe(1);
      expect(syncScansService.syncScans).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org_test_123',
          sessionUserId: 'u-session',
        })
      );
    });

    it("session : actorUserId du payload est transmis mais le service décidera de l'ignorer", async () => {
      await request(app)
        .post('/api/sync/scans')
        .send({ items: [validItem], actorUserId: '550e8400-e29b-41d4-a716-446655440099' });

      // Le controller transmet les deux ; le service décide. On vérifie juste le transit.
      expect(syncScansService.syncScans).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionUserId: 'u-session',
          actorUserId: '550e8400-e29b-41d4-a716-446655440099',
        })
      );
    });
  });

  describe('M2M mode (x-api-key)', () => {
    it('retourne 207 quand actorUserId est fourni', async () => {
      const res = await request(app)
        .post('/api/sync/scans')
        .set('x-api-key', 'any-key')
        .send({
          items: [validItem],
          actorUserId: '550e8400-e29b-41d4-a716-446655440099',
        });

      expect(res.status).toBe(207);
      expect(syncScansService.syncScans).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org_test_123',
          sessionUserId: undefined,
          actorUserId: '550e8400-e29b-41d4-a716-446655440099',
        })
      );
    });

    it('transmet le rejet du service au client (ex: 403 actor non membre)', async () => {
      vi.mocked(syncScansService.syncScans).mockRejectedValue({
        status: 403,
        body: {
          error: [{ field: 'actorUserId', message: 'Utilisateur non membre ou rôle insuffisant' }],
        },
      });

      const res = await request(app)
        .post('/api/sync/scans')
        .set('x-api-key', 'any-key')
        .send({
          items: [validItem],
          actorUserId: '550e8400-e29b-41d4-a716-446655440099',
        });

      expect(res.status).toBe(403);
      expect(res.body.error[0].field).toBe('actorUserId');
    });

    it('retourne 400 si actorUserId manque en M2M (rejet du service propagé)', async () => {
      vi.mocked(syncScansService.syncScans).mockRejectedValue({
        status: 400,
        body: { error: [{ field: 'actorUserId', message: 'actorUserId requis en mode M2M' }] },
      });

      const res = await request(app)
        .post('/api/sync/scans')
        .set('x-api-key', 'any-key')
        .send({ items: [validItem] }); // PAS d'actorUserId

      expect(res.status).toBe(400);
      expect(res.body.error[0].field).toBe('actorUserId');
      // Le controller doit avoir appelé le service avec actorUserId undefined
      expect(syncScansService.syncScans).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionUserId: undefined,
          actorUserId: undefined,
        })
      );
    });
  });

  describe('Validation', () => {
    it('rejette le payload invalide (400) avant d appeler le service', async () => {
      const res = await request(app).post('/api/sync/scans').send({ items: [] });
      expect(res.status).toBe(400);
      expect(syncScansService.syncScans).not.toHaveBeenCalled();
    });

    it('rejette si le body ne contient pas items', async () => {
      const res = await request(app).post('/api/sync/scans').send({});
      expect(res.status).toBe(400);
      expect(syncScansService.syncScans).not.toHaveBeenCalled();
    });
  });

  it('retourne 207 même en cas de mix succès / erreur', async () => {
    vi.mocked(syncScansService.syncScans).mockResolvedValue({
      results: [
        { clientOpId: 'a', status: 'ok', serverId: { receiptId: 'r1', batchId: 'b1' } },
        {
          clientOpId: 'b',
          status: 'error',
          error: { field: 'id_fournisseur', message: 'Fournisseur introuvable ou accès refusé' },
        },
      ],
      summary: { total: 2, ok: 1, error: 1, conflict: 0 },
    });

    const item2 = {
      ...validItem,
      clientOpId: '550e8400-e29b-41d4-a716-446655440001',
      payload: { ...validReceiptPayload, shipment_id: 'SHIP-2' },
    };
    const res = await request(app)
      .post('/api/sync/scans')
      .send({ items: [validItem, item2] });

    expect(res.status).toBe(207);
    expect(res.body.data.summary).toEqual({ total: 2, ok: 1, error: 1, conflict: 0 });
  });
});
