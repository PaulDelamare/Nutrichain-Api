import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { globalErrorHandler } from '../../../../shared/utils/errorHandler/errorHandler';
import { AuthenticatedRequest, AuthUser, AuthSession } from '../../../identity/types/auth.types';

// Mock des middlewares
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

// Importer le router APRÈS les mocks
import transformationRouter from './transformation.routes';

describe('Transformation Routes Integration', () => {
  const app = express();
  app.use(express.json());
  app.use('/api', transformationRouter);
  app.use(globalErrorHandler);

  it('doit rejeter la transformation si des champs obligatoires sont manquants (422)', async () => {
    const res = await request(app).post('/api/traceability/transformations').send({
      id_produit_fini: 'invalid-uuid',
    });

    if (res.status !== 400) {
      console.log('Error Body:', JSON.stringify(res.body, null, 2));
    }

    expect(res.status).toBe(400);
  });

  /**
   * Un test de schéma ne prouve pas le câblage : `.distinct()` peut être posé sur le schéma sans
   * jamais être branché sur la route réelle. Ce test passe par le VRAI routeur (#118).
   */
  it('doit rejeter (400) le même lot parent saisi deux fois, avant tout appel service', async () => {
    const res = await request(app)
      .post('/api/traceability/transformations')
      .send({
        id_produit_fini: '11111111-1111-4111-8111-111111111111',
        id_materiel: '22222222-2222-4222-8222-222222222222',
        quantite_produite: 10,
        unite_code: 'KG',
        inputs: [
          { id_lot_parent: '33333333-3333-4333-8333-333333333333', quantite_prelevee: 5, unite: 'KG' },
          { id_lot_parent: '33333333-3333-4333-8333-333333333333', quantite_prelevee: 3, unite: 'KG' },
        ],
      });

    expect(res.status).toBe(400);
  });
});
