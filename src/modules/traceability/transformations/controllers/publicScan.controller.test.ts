import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { globalErrorHandler } from '../../../../shared/utils/errorHandler/errorHandler';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    batch: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../services/genealogy.service', () => ({
  genealogyService: {
    getUpstream: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../../identity/middlewares/requireAuth.middleware', () => ({
  requireAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}));
vi.mock('../../../identity/middlewares/requireOrgRole.middleware', () => ({
  requireOrgRole:
    () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
}));

import transformationRouter from '../routes/transformation.routes';
import { prisma } from '../../../../shared/configs/prismaClient.config';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api', transformationRouter);
  app.use(globalErrorHandler);
  return app;
};

const buildBatch = (overrides: Record<string, unknown> = {}) => ({
  id: 'batch-1',
  organization_id: 'org-1',
  statut: 'EXPEDIE',
  date_peremption: new Date('2027-01-01'),
  produit: { nom: 'Yaourt nature', code_gtin: '1234567890' },
  organization: { name: 'Ferme Bio' },
  ...overrides,
});

describe('publicScanBatch controller (route publique B2C — Sec C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('doit refuser (404) un lot non encore expédié (statut EN_STOCK)', async () => {
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(null);

    const res = await request(buildApp()).get('/api/public/scan/batch-1');

    expect(res.status).toBe(404);
  });

  it('doit accepter (200) un lot EXPEDIE et exposer un payload limité', async () => {
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(buildBatch({ statut: 'EXPEDIE' }));

    const res = await request(buildApp()).get('/api/public/scan/batch-1');

    expect(res.status).toBe(200);
    expect(res.body.data.lot.nom_produit).toBe('Yaourt nature');
    expect(res.body.data.lot.statut_sanitaire).toBe('CONFORME');
    expect(res.body.data.lot).not.toHaveProperty('organization_id');
    expect(res.body.data.lot).not.toHaveProperty('quantite_actuelle');
  });

  it('doit accepter (200) un lot ALERTE et signaler RAPPEL_CONSOMMATEUR', async () => {
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(buildBatch({ statut: 'ALERTE' }));

    const res = await request(buildApp()).get('/api/public/scan/batch-1');

    expect(res.status).toBe(200);
    expect(res.body.data.lot.statut_sanitaire).toBe('RAPPEL_CONSOMMATEUR');
  });
});
