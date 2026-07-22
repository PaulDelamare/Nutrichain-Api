import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type express from 'express';

vi.mock('../../../shared/configs/prismaClient.config', () => {
  const prisma = {
    ePCIS_Event: { findMany: vi.fn().mockResolvedValue([]) },
    unit: { findMany: vi.fn().mockResolvedValue([{ code: 'L' }]) },
    product: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    // Chaque ligne écrite est journalisée dans SA transaction : le mock rejoue le callback.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: (cb: any) => cb(prisma),
  };
  return { prisma, bdd: prisma };
});

vi.mock('../../../shared/utils/audit/audit.service', () => ({
  auditService: { logAction: vi.fn() },
}));

/**
 * La session d'un administrateur est simulée ICI, et seulement ici : ce fichier teste le
 * traitement du CSV, pas la garde d'accès. Le refus de la clé API seule est prouvé, lui, contre
 * les middlewares RÉELS dans `connector.security.test.ts` — un test d'accès qui simule sa propre
 * garde ne prouve rien.
 */
vi.mock('../../../shared/middlewares/sessionAuth', () => ({
  sessionAuth: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    Object.assign(req, {
      activeOrgId: 'org-test',
      auth: { activeOrgId: 'org-test', user: { id: 'admin-1' }, role: 'admin' },
    });
    next();
  },
}));

import { app } from '../../../app';

const PRODUCT_CSV =
  'nom,code_gtin,categorie,duree_conservation_defaut,seuil_alerte_stock,unite_reference\n' +
  'Lait,3001234567890,Frais,30,10,L';

describe('Connecteurs — traitement du CSV (session administrateur)', () => {
  beforeEach(() => {
    process.env.API_KEY = 'test-key';
    process.env.API_KEY_ORG_ID = 'org-test';
  });

  it('exporte les événements EPCIS en CSV', async () => {
    const res = await request(app).get('/api/connectors/exports/events');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('event_time,event_type,related_entity,related_id,payload');
  });

  it('importe les produits et rend un rapport', async () => {
    const res = await request(app)
      .post('/api/connectors/imports/products')
      .set('Content-Type', 'text/csv')
      .send(PRODUCT_CSV);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 1, created: 1, errors: 0 });
  });

  it('rejette un import au corps vide', async () => {
    const res = await request(app)
      .post('/api/connectors/imports/products')
      .set('Content-Type', 'text/csv')
      .send('');

    expect(res.status).toBe(400);
  });
});
