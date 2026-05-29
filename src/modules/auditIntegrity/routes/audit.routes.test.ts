import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { globalErrorHandler } from '../../../shared/utils/errorHandler/errorHandler';
import { AuthenticatedRequest, AuthUser, AuthSession } from '../../identity/types/auth.types';

const authState = { authenticated: true, rolePass: true };

vi.mock('../../identity/middlewares/requireAuth.middleware', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    if (!authState.authenticated) {
      return next({ status: 401, error: [{ field: 'auth', message: 'Non authentifié.' }] });
    }
    (req as AuthenticatedRequest).auth = {
      user: { id: 'admin' } as unknown as AuthUser,
      session: { activeOrganizationId: 'org-1' } as unknown as AuthSession,
      activeOrgId: 'org-1',
    };
    (req as AuthenticatedRequest).activeOrgId = 'org-1';
    next();
  },
}));

vi.mock('../../identity/middlewares/requireOrgRole.middleware', () => ({
  requireOrgRole: () => (req: Request, _res: Response, next: NextFunction) => {
    if (!authState.rolePass) {
      return next({ status: 403, error: [{ field: 'auth', message: 'Rôle insuffisant.' }] });
    }
    next();
  },
}));

vi.mock('../services/auditVerify.service', () => ({
  auditVerifyService: { verifyChain: vi.fn() },
}));

import auditRouter from './audit.routes';
import { auditVerifyService } from '../services/auditVerify.service';

describe('Audit Routes Integration', () => {
  const app = express();
  app.use(express.json());
  app.use('/api', auditRouter);
  app.use(globalErrorHandler);

  beforeEach(() => {
    vi.resetAllMocks();
    authState.authenticated = true;
    authState.rolePass = true;
  });

  it('1. 200 happy + header Cache-Control: no-store', async () => {
    vi.mocked(auditVerifyService.verifyChain).mockResolvedValue({
      valid: true,
      rowsChecked: 5,
      lastSignatureHash: 'h',
      lastHorodatage: new Date(),
      lastId: 5,
      brokenAtId: null,
      brokenAtReason: null,
      expectedRowCount: null,
      actualRowCount: null,
    });
    const res = await request(app).get('/api/audit/verify');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.valid).toBe(true);
  });

  it('2. 401 sans session', async () => {
    authState.authenticated = false;
    const res = await request(app).get('/api/audit/verify');
    expect(res.status).toBe(401);
  });

  it('3. 403 rôle insuffisant', async () => {
    authState.rolePass = false;
    const res = await request(app).get('/api/audit/verify');
    expect(res.status).toBe(403);
  });

  it('4. 200 avec shape complète valid:false propagée (brokenAtId + brokenAtReason)', async () => {
    vi.mocked(auditVerifyService.verifyChain).mockResolvedValue({
      valid: false,
      rowsChecked: 3,
      lastSignatureHash: null,
      lastHorodatage: null,
      lastId: null,
      brokenAtId: 42,
      brokenAtReason: 'signature_mismatch',
      expectedRowCount: null,
      actualRowCount: null,
    });
    const res = await request(app).get('/api/audit/verify');
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.brokenAtId).toBe(42);
    expect(res.body.data.brokenAtReason).toBe('signature_mismatch');
  });
});
