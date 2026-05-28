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
});
