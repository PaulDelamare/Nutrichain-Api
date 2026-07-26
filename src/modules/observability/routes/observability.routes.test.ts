import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { globalErrorHandler } from '../../../shared/utils/errorHandler/errorHandler';
import { AuthenticatedRequest, AuthUser, AuthSession } from '../../identity/types/auth.types';

const authState = { authenticated: true, rolePass: true, activeOrgId: 'org-1' };

vi.mock('../../identity/middlewares/requireAuth.middleware', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    if (!authState.authenticated) {
      return next({ status: 401, error: [{ field: 'auth', message: 'Non authentifié.' }] });
    }
    (req as AuthenticatedRequest).auth = {
      user: { id: 'admin' } as unknown as AuthUser,
      session: { activeOrganizationId: authState.activeOrgId } as unknown as AuthSession,
      activeOrgId: authState.activeOrgId,
    };
    (req as AuthenticatedRequest).activeOrgId = authState.activeOrgId;
    next();
  },
}));

// Capturé HORS du cycle de vie des mocks vi.fn() : les routes sont importées une seule fois au
// chargement du module, avant tout `beforeEach`, donc un `vi.fn()` verrait son historique vidé par
// `vi.resetAllMocks()` avant qu'un test ne puisse l'observer. `vi.hoisted` pour survivre au hoisting
// de `vi.mock`.
const { requireOrgRoleCalls } = vi.hoisted(() => ({ requireOrgRoleCalls: [] as string[][] }));

vi.mock('../../identity/middlewares/requireOrgRole.middleware', () => ({
  requireOrgRole: (allowedRoles: string[]) => {
    requireOrgRoleCalls.push(allowedRoles);
    return (req: Request, _res: Response, next: NextFunction) => {
      if (!authState.rolePass) {
        return next({ status: 403, error: [{ field: 'auth', message: 'Rôle insuffisant.' }] });
      }
      next();
    };
  },
}));

vi.mock('../services/observability.service', () => ({
  observabilityService: { getDashboardMetrics: vi.fn() },
}));

import observabilityRouter from './observability.routes';
import { observabilityService, DashboardMetrics } from '../services/observability.service';
import { ADMIN_ROLES } from '../../identity/constants/roles.constants';

const emptyMetrics: DashboardMetrics = {
  requestLatency: [],
  requestVolumeSeries: [],
  auditEntryCount: 0,
  alerts: [],
  kpis: { totalRequests: 0, errorRate: 0, auditEntryCount: 0, activeAlertCount: 0 },
  windowHours: 24,
};

describe('Observability Routes Integration', () => {
  const app = express();
  app.use(express.json());
  app.use('/api', observabilityRouter);
  app.use(globalErrorHandler);

  beforeEach(() => {
    vi.resetAllMocks();
    authState.authenticated = true;
    authState.rolePass = true;
    authState.activeOrgId = 'org-1';
    vi.mocked(observabilityService.getDashboardMetrics).mockResolvedValue(emptyMetrics);
  });

  it('1. GET /observability/metrics : 200 + header Cache-Control: no-store', async () => {
    const res = await request(app).get('/api/observability/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.auditEntryCount).toBe(0);
  });

  it('2. GET /observability/metrics : 401 sans session', async () => {
    authState.authenticated = false;
    const res = await request(app).get('/api/observability/metrics');
    expect(res.status).toBe(401);
  });

  it('3. GET /observability/metrics : 403 rôle insuffisant (viewer/operator)', async () => {
    authState.rolePass = false;
    const res = await request(app).get('/api/observability/metrics');
    expect(res.status).toBe(403);
  });

  it('4. GET /observability/metrics : le service reçoit organizationId = activeOrgId de la session (cloisonnement)', async () => {
    authState.activeOrgId = 'org-tenant-42';
    await request(app).get('/api/observability/metrics');
    expect(observabilityService.getDashboardMetrics).toHaveBeenCalledWith({
      organizationId: 'org-tenant-42',
    });
  });

  it('5. GET /observability/dashboard : 200 + Content-Type HTML', async () => {
    const res = await request(app).get('/api/observability/dashboard');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('<!doctype html>');
  });

  it('6. GET /observability/dashboard : 403 rôle insuffisant', async () => {
    authState.rolePass = false;
    const res = await request(app).get('/api/observability/dashboard');
    expect(res.status).toBe(403);
  });

  it('7. GET /observability/dashboard : 401 sans session', async () => {
    authState.authenticated = false;
    const res = await request(app).get('/api/observability/dashboard');
    expect(res.status).toBe(401);
  });

  it('8. les deux routes exigent précisément ADMIN_ROLES, pas une liste plus large', () => {
    expect(requireOrgRoleCalls).toHaveLength(2);
    for (const allowedRoles of requireOrgRoleCalls) {
      expect(allowedRoles).toEqual(ADMIN_ROLES);
      expect(allowedRoles).not.toEqual(expect.arrayContaining(['operator', 'viewer', 'quality']));
    }
  });
});
