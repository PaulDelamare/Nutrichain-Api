import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { globalErrorHandler } from '../../../shared/utils/errorHandler/errorHandler';
import { AuthenticatedRequest } from '../../identity/types/auth.types';

const sessionAuthMock = vi.fn();

vi.mock('../../../shared/middlewares/sessionAuth', () => ({
  // Wrapper évalué à la requête : sessionAuthMock n'existe pas encore au moment
  // où les routes appellent sessionAuth() (hoisting de vi.mock).
  sessionAuth: () => (req: express.Request, res: express.Response, next: express.NextFunction) =>
    sessionAuthMock(req, res, next),
}));

vi.mock('../services/organization.service', () => ({
  organizationService: {
    listMembers: vi.fn().mockResolvedValue([{ id: 'm-1', role: 'owner' }]),
    listAlerts: vi.fn().mockResolvedValue([]),
    listAuditLogs: vi.fn().mockResolvedValue([]),
    listQualityControls: vi.fn().mockResolvedValue([]),
    listQuarantineBatches: vi.fn().mockResolvedValue([]),
    listEquipment: vi.fn().mockResolvedValue([]),
    listMovements: vi.fn().mockResolvedValue([]),
    listSuppliers: vi.fn().mockResolvedValue([]),
    listCustomers: vi.fn().mockResolvedValue([]),
    listShipments: vi.fn().mockResolvedValue([]),
  },
}));

import organizationRouter from './organization.routes';
import { organizationService } from '../services/organization.service';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api', organizationRouter);
  app.use(globalErrorHandler);
  return app;
};

const authAs = (orgId: string, role = 'operator') => {
  sessionAuthMock.mockImplementation((req: AuthenticatedRequest, _res, next) => {
    req.activeOrgId = orgId;
    req.auth = { role } as AuthenticatedRequest['auth'];
    next();
  });
};

describe('Organization routes (façade de lecture front)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /organization/members : 200 avec l'enveloppe { status, message, data } lue par le front", async () => {
    authAs('org-1');

    const res = await request(buildApp()).get('/api/organization/members');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 'm-1', role: 'owner' }]);
    expect(organizationService.listMembers).toHaveBeenCalledWith('org-1');
  });

  it('GET /organization/audit-logs : le limit validé est transmis, défaut 30 sinon', async () => {
    authAs('org-1');
    const app = buildApp();

    await request(app).get('/api/organization/audit-logs?limit=50');
    expect(organizationService.listAuditLogs).toHaveBeenCalledWith('org-1', 50);

    await request(app).get('/api/organization/audit-logs');
    expect(organizationService.listAuditLogs).toHaveBeenLastCalledWith('org-1', 30);
  });

  it('GET /organization/audit-logs : 400 si limit dépasse le plafond de volumétrie (500)', async () => {
    authAs('org-1');

    const res = await request(buildApp()).get('/api/organization/audit-logs?limit=9999');

    expect(res.status).toBe(400);
    expect(organizationService.listAuditLogs).not.toHaveBeenCalled();
  });

  it('GET /organization/movements : lotId non-UUID rejeté en 400 (VineJS)', async () => {
    authAs('org-1');

    const res = await request(buildApp()).get('/api/organization/movements?lotId=pas-un-uuid');

    expect(res.status).toBe(400);
    expect(organizationService.listMovements).not.toHaveBeenCalled();
  });

  it('GET /organization/movements : un opérateur ne révèle PAS l’auteur des mouvements', async () => {
    authAs('org-1', 'operator');
    const lotId = '11111111-1111-4111-8111-111111111111';

    await request(buildApp()).get(`/api/organization/movements?lotId=${lotId}&limit=10`);

    expect(organizationService.listMovements).toHaveBeenCalledWith('org-1', {
      lotId,
      limit: 10,
      revealAuthor: false,
    });
  });

  it('GET /organization/movements : un admin révèle l’auteur', async () => {
    authAs('org-1', 'admin');
    const lotId = '11111111-1111-4111-8111-111111111111';

    await request(buildApp()).get(`/api/organization/movements?lotId=${lotId}&limit=10`);

    expect(organizationService.listMovements).toHaveBeenCalledWith('org-1', {
      lotId,
      limit: 10,
      revealAuthor: true,
    });
  });

  it('GET /organization/suppliers : un opérateur ne révèle PAS les données personnelles', async () => {
    authAs('org-1', 'operator');

    await request(buildApp()).get('/api/organization/suppliers?includeArchived=true');

    // includeArchived est ignoré pour un non-admin, revealPersonalData=false.
    expect(organizationService.listSuppliers).toHaveBeenCalledWith('org-1', {
      includeArchived: false,
      revealPersonalData: false,
    });
  });

  it('GET /organization/customers : un admin révèle les données personnelles et honore includeArchived', async () => {
    authAs('org-1', 'admin');

    await request(buildApp()).get('/api/organization/customers?includeArchived=true');

    expect(organizationService.listCustomers).toHaveBeenCalledWith('org-1', {
      includeArchived: true,
      revealPersonalData: true,
    });
  });

  it("chaque endpoint reste derrière l'auth : 401 quand sessionAuth rejette", async () => {
    sessionAuthMock.mockImplementation((_req, res) => {
      res.status(401).json({ status: 401, error: [{ field: 'auth', message: 'Non authentifié' }] });
    });
    const app = buildApp();

    for (const path of ['members', 'alerts', 'suppliers', 'customers', 'shipments']) {
      const res = await request(app).get(`/api/organization/${path}`);
      expect(res.status).toBe(401);
    }
    expect(organizationService.listMembers).not.toHaveBeenCalled();
  });
});
