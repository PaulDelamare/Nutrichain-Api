import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { globalErrorHandler } from '../../../../shared/utils/errorHandler/errorHandler';
import { AuthenticatedRequest, AuthUser, AuthSession } from '../../../identity/types/auth.types';

// Mock des middlewares d'authentification : injecte une session owner valide.
vi.mock('../../../identity/middlewares/requireAuth.middleware', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as AuthenticatedRequest).auth = {
      user: { id: 'user-123' } as unknown as AuthUser,
      session: { id: 'sess-123', activeOrganizationId: 'org-123' } as unknown as AuthSession,
      activeOrgId: 'org-123',
    };
    (req as AuthenticatedRequest).activeOrgId = 'org-123';
    next();
  },
}));

vi.mock('../../../identity/middlewares/requireOrgRole.middleware', () => ({
  requireOrgRole: () => (req: Request, _res: Response, next: NextFunction) => next(),
}));

// Mock des services métier consommés par recall.controller
vi.mock('../services/genealogy.service', () => ({
  genealogyService: {
    getUpstream: vi.fn(),
    getDownstream: vi.fn(),
  },
}));

vi.mock('../services/recall.service', () => ({
  recallService: {
    triggerRecall: vi.fn(),
  },
}));

// Importer le router APRÈS les mocks
import transformationRouter from '../routes/transformation.routes';
import { genealogyService } from '../services/genealogy.service';
import { recallService } from '../services/recall.service';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api', transformationRouter);
  app.use(globalErrorHandler);
  return app;
};

describe('GET /api/traceability/batches/:id/genealogy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retourne 200 avec upstream et downstream pour le bon lot et la bonne org', async () => {
    const upstream = [{ id: 'lot-parent', nom_produit: 'Lait' }];
    const downstream = [{ id: 'lot-enfant', nom_produit: 'Yaourt' }];
    vi.mocked(genealogyService.getUpstream).mockResolvedValue(upstream as never);
    vi.mocked(genealogyService.getDownstream).mockResolvedValue(downstream as never);

    const res = await request(buildApp()).get('/api/traceability/batches/lot-1/genealogy');

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Généalogie récupérée.');
    expect(res.body.data).toEqual({ batchId: 'lot-1', upstream, downstream });
    expect(genealogyService.getUpstream).toHaveBeenCalledWith('lot-1', 'org-123');
    expect(genealogyService.getDownstream).toHaveBeenCalledWith('lot-1', 'org-123');
  });
});

describe('POST /api/traceability/batches/:id/recall', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retourne 400 si le motif est manquant', async () => {
    const res = await request(buildApp()).post('/api/traceability/batches/lot-1/recall').send({});

    expect(res.status).toBe(400);
    expect(recallService.triggerRecall).not.toHaveBeenCalled();
  });

  it('retourne 200 et transmet (id, org, user, reason) au service', async () => {
    const result = {
      blockedBatchesCount: 3,
      impactedBatchIds: ['lot-1', 'lot-2', 'lot-3'],
      affectedShipments: [],
      depthSaturated: false,
    };
    vi.mocked(recallService.triggerRecall).mockResolvedValue(result as never);

    const res = await request(buildApp())
      .post('/api/traceability/batches/lot-1/recall')
      .send({ reason: 'Contamination listeria' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(result);
    expect(recallService.triggerRecall).toHaveBeenCalledWith(
      'lot-1',
      'org-123',
      'user-123',
      'Contamination listeria'
    );
  });
});
