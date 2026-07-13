import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import { app } from '../../../app';
import { syncScansService } from '../services/syncScans.service';

/**
 * Une session d'opérateur est simulée : ce fichier teste le COMPORTEMENT de la route.
 *
 * Le mock précédent mimait l'ancien `mixedAuth` : il basculait en « mode machine » dès qu'un
 * en-tête `x-api-key` était présent, et trois tests certifiaient un chemin qui n'existe plus.
 * Ils seraient restés verts si l'on rétablissait le contournement par clé — un test qui simule
 * la garde qu'il prétend prouver ne prouve rien.
 *
 * Le refus de la clé seule est prouvé contre les middlewares RÉELS, ailleurs
 * (`receipt.roles.test.ts`, `connector.security.test.ts`).
 */
vi.mock('../../../shared/middlewares/sessionAuth', () => ({
  sessionAuth: vi.fn(() => (req: Request, _res: Response, next: NextFunction) => {
    Object.assign(req, {
      activeOrgId: 'org_test_123',
      auth: {
        user: { id: 'u-session', email: 'op@nutrichain.local' },
        activeOrgId: 'org_test_123',
        role: 'operator',
        session: { activeOrganizationId: 'org_test_123' },
      },
    });
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
  it('retourne 207 et passe l’opérateur de la SESSION au service', async () => {
    const res = await request(app).post('/api/sync/scans').send({ items: [validItem] });

    expect(res.status).toBe(207);
    expect(res.body.data.summary.ok).toBe(1);
    expect(syncScansService.syncScans).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_test_123',
        sessionUserId: 'u-session',
      })
    );
  });

  it('ignore tout auteur déclaré dans le corps de la requête', async () => {
    // Le champ n'existe plus au schéma. S'il revenait, il ne doit jamais atteindre le service :
    // l'identité scellée dans l'audit WORM ne se négocie pas avec le client.
    await request(app)
      .post('/api/sync/scans')
      .send({ items: [validItem], actorUserId: 'usurpateur' });

    expect(syncScansService.syncScans).toHaveBeenCalledWith(
      expect.not.objectContaining({ actorUserId: 'usurpateur' })
    );
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
