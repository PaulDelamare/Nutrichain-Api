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
    listMembers: vi.fn().mockResolvedValue({
      data: [{ id: 'm-1', role: 'owner' }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    }),
    listAlerts: vi.fn().mockResolvedValue([]),
    listRecalls: vi.fn().mockResolvedValue({
      data: [{ id: 'a-1', type: 'PRODUCT_RECALL' }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    }),
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

  it("GET /organization/members : 200 avec l'enveloppe paginée { data, pagination } lue par le front", async () => {
    authAs('org-1');

    const res = await request(buildApp()).get('/api/organization/members');

    expect(res.status).toBe(200);
    expect(res.body.data.data).toEqual([{ id: 'm-1', role: 'owner' }]);
    expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 20, total: 1 });
    expect(organizationService.listMembers).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ page: 1, limit: 20 })
    );
  });

  it('GET /organization/members : transmet les filtres de colonnes au service', async () => {
    authAs('org-1');

    const res = await request(buildApp()).get(
      '/api/organization/members?email=ana&role=operator&mfa=false&page=2'
    );

    expect(res.status).toBe(200);
    expect(organizationService.listMembers).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ email: 'ana', role: 'operator', mfa: false, page: 2 })
    );
  });

  it('GET /organization/members : 400 sur un rôle hors énumération, sans atteindre le service', async () => {
    authAs('org-1');

    const res = await request(buildApp()).get('/api/organization/members?role=superuser');

    expect(res.status).toBe(400);
    expect(organizationService.listMembers).not.toHaveBeenCalled();
  });

  it('GET /organization/members : 400 sur un mfa non booléen', async () => {
    authAs('org-1');

    const res = await request(buildApp()).get('/api/organization/members?mfa=peut-etre');

    expect(res.status).toBe(400);
    expect(organizationService.listMembers).not.toHaveBeenCalled();
  });

  it("GET /organization/recalls : 200 avec l'enveloppe paginée { data, pagination }", async () => {
    authAs('org-1');

    const res = await request(buildApp()).get('/api/organization/recalls');

    expect(res.status).toBe(200);
    expect(res.body.data.data).toEqual([{ id: 'a-1', type: 'PRODUCT_RECALL' }]);
    expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 20, total: 1 });
    expect(organizationService.listRecalls).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ page: 1, limit: 20 })
    );
  });

  it('GET /organization/recalls : transmet la recherche et le statut au service', async () => {
    authAs('org-1');

    const res = await request(buildApp()).get(
      '/api/organization/recalls?q=listeria&statut=cloture&page=2'
    );

    expect(res.status).toBe(200);
    expect(organizationService.listRecalls).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ q: 'listeria', statut: 'cloture', page: 2 })
    );
  });

  it('GET /organization/recalls : 400 sur un statut hors énumération, sans atteindre le service', async () => {
    authAs('org-1');

    const res = await request(buildApp()).get('/api/organization/recalls?statut=peut-etre');

    expect(res.status).toBe(400);
    expect(organizationService.listRecalls).not.toHaveBeenCalled();
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

  it('GET /organization/shipments : 400 sur un statut hors énumération, sans atteindre le service', async () => {
    authAs('org-1');

    const res = await request(buildApp()).get('/api/organization/shipments?statut=PEUT_ETRE');

    expect(res.status).toBe(400);
    expect(organizationService.listShipments).not.toHaveBeenCalled();
  });

  it('GET /organization/shipments : 400 sur une date malformée', async () => {
    authAs('org-1');

    const res = await request(buildApp()).get('/api/organization/shipments?date=31-07-2026');

    expect(res.status).toBe(400);
    expect(organizationService.listShipments).not.toHaveBeenCalled();
  });

  it('GET /organization/shipments : transmet les filtres de colonnes au service', async () => {
    authAs('org-1');

    const res = await request(buildApp()).get(
      '/api/organization/shipments?ref=BL-9&client=cli-1&statut=LIVRE&date=2026-07-31&page=2'
    );

    expect(res.status).toBe(200);
    expect(organizationService.listShipments).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        ref: 'BL-9',
        client: 'cli-1',
        statut: 'LIVRE',
        date: '2026-07-31',
        page: 2,
      })
    );
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
