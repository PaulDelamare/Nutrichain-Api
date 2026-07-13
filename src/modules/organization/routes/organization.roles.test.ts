import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const getSession = vi.fn();
const getFullOrganization = vi.fn();

// On exerce le VRAI sessionAuth/requireOrgRole : ce qu'on teste, c'est la liste des rôles
// autorisés. Les autres tests de ces routes simulent sessionAuth et ne verraient donc AUCUNE
// régression d'autorisation — d'où ce fichier dédié.
vi.mock('../../identity/auth.config', () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSession(...args),
      getFullOrganization: (...args: unknown[]) => getFullOrganization(...args),
    },
  },
}));

// Contrôleurs et validations en aval neutralisés : on isole la garde de rôle.
const ok = (_req: express.Request, res: express.Response) => res.status(200).end();
vi.mock('../controllers/organization.controller', () => ({
  listMembersController: ok,
  listAlertsController: ok,
  listAuditLogsController: ok,
  listCustomersController: ok,
  listEquipmentController: ok,
  listMovementsController: ok,
  listQualityControlsController: ok,
  listQuarantineBatchesController: ok,
  listShipmentsController: ok,
  listSuppliersController: ok,
}));
vi.mock('../controllers/equipment.controller', () => ({
  createEquipmentController: ok,
  getEquipmentLabelController: ok,
  listLocationsController: ok,
}));
vi.mock('../middlewares/validateOrganizationQuery.middleware', () => ({
  validateOrganizationQuery: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}));
vi.mock('../middlewares/validateEquipment.middleware', () => ({
  validateCreateEquipment: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}));

const { default: organizationRoutes } = await import('./organization.routes');
const { globalErrorHandler } = await import('../../../shared/utils/errorHandler/errorHandler');

const app = express();
app.use(express.json());
app.use('/api', organizationRoutes);
app.use(globalErrorHandler);

function signedInAs(role: string): void {
  getSession.mockResolvedValue({
    user: { id: 'u-1' },
    session: { activeOrganizationId: 'org-1' },
  });
  getFullOrganization.mockResolvedValue({ id: 'org-1', members: [{ userId: 'u-1', role }] });
}

beforeEach(() => vi.clearAllMocks());

describe('RBAC des lectures organisation (session réelle)', () => {
  // Données personnelles : réservées à l'administration (moindre privilège + RGPD).
  const PERSONAL = ['/api/organization/members', '/api/organization/audit-logs', '/api/organization/customers', '/api/organization/suppliers'];

  describe('données personnelles → admin/owner seulement', () => {
    for (const url of PERSONAL) {
      it(`${url} : autorise admin`, async () => {
        signedInAs('admin');
        expect((await request(app).get(url)).status).toBe(200);
      });

      it(`${url} : REFUSE viewer (403) — c'était la fuite`, async () => {
        signedInAs('viewer');
        expect((await request(app).get(url)).status).toBe(403);
      });

      it(`${url} : REFUSE operator (403)`, async () => {
        signedInAs('operator');
        expect((await request(app).get(url)).status).toBe(403);
      });
    }
  });

  describe('lectures métier → tous les rôles', () => {
    const BUSINESS = ['/api/organization/alerts', '/api/organization/equipment', '/api/organization/movements'];

    for (const url of BUSINESS) {
      it(`${url} : autorise viewer`, async () => {
        signedInAs('viewer');
        expect((await request(app).get(url)).status).toBe(200);
      });
    }
  });
});
