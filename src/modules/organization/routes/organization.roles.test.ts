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
  configCountsController: ok,
  listMembersController: ok,
  listAlertsController: ok,
  listRecallsController: ok,
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
  validateOrganizationQuery: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
}));
vi.mock('../controllers/member.controller', () => ({
  changeMemberRoleController: ok,
  transferOwnershipController: ok,
  revokeMemberController: ok,
}));
vi.mock('../controllers/iotGateway.controller', () => ({
  listIotGatewaysController: ok,
  createIotGatewayController: ok,
  revokeIotGatewayController: ok,
}));
vi.mock('../middlewares/iotGateway.schema', () => ({
  validateCreateIotGateway: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
}));
vi.mock('../middlewares/validateEquipment.middleware', () => ({
  validateCreateEquipment: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
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
  // Fournisseurs et clients n'y sont PLUS : la route est ouverte à tous les rôles, la restriction
  // (identité métier seule pour les non-admins) se fait sur la PROJECTION, pas sur la garde
  // (cf. organization.service : select réduit sans revealPersonalData). Issue #116.
  const PERSONAL = ['/api/organization/members', '/api/organization/audit-logs'];

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
    const BUSINESS = [
      '/api/organization/alerts',
      '/api/organization/equipment',
      '/api/organization/movements',
      // Ouverts par #116 : l'opérateur en a besoin pour réceptionner / expédier. La donnée
      // personnelle est filtrée dans la projection, pas ici.
      '/api/organization/suppliers',
      '/api/organization/customers',
    ];

    for (const url of BUSINESS) {
      it(`${url} : autorise viewer`, async () => {
        signedInAs('viewer');
        expect((await request(app).get(url)).status).toBe(200);
      });

      it(`${url} : autorise operator`, async () => {
        signedInAs('operator');
        expect((await request(app).get(url)).status).toBe(200);
      });
    }
  });

  // La clé d'une passerelle vaut le droit de mettre TOUS les lots d'un frigo en quarantaine :
  // l'émettre est une action d'administration, pas une opération de terrain (#93).
  describe('passerelles IoT → administration seule', () => {
    it('POST /api/organization/iot-gateways : autorise admin', async () => {
      signedInAs('admin');
      const res = await request(app)
        .post('/api/organization/iot-gateways')
        .send({ nom: 'Passerelle Nord' });
      expect(res.status).toBe(200);
    });

    for (const role of ['operator', 'quality', 'viewer']) {
      it(`POST /api/organization/iot-gateways : REFUSE ${role} (403)`, async () => {
        signedInAs(role);
        const res = await request(app)
          .post('/api/organization/iot-gateways')
          .send({ nom: 'Passerelle pirate' });
        expect(res.status).toBe(403);
      });

      it(`GET /api/organization/iot-gateways : REFUSE ${role} (403)`, async () => {
        signedInAs(role);
        expect((await request(app).get('/api/organization/iot-gateways')).status).toBe(403);
      });

      it(`POST /api/organization/iot-gateways/:id/revoke : REFUSE ${role} (403)`, async () => {
        signedInAs(role);
        const res = await request(app).post('/api/organization/iot-gateways/gw-1/revoke');
        expect(res.status).toBe(403);
      });
    }
  });

  // Seul le propriétaire ACTUEL cède sa fonction — contrairement à CONFIG_ROLES (owner+admin) qui
  // gouverne le reste de la gestion des membres, `admin` est ici REFUSÉ : sinon un admin pourrait
  // se déclarer lui-même propriétaire.
  describe('cession de propriété → propriétaire seul', () => {
    it('POST /api/organization/members/:id/transfer-ownership : autorise owner', async () => {
      signedInAs('owner');
      const res = await request(app).post('/api/organization/members/m1/transfer-ownership');
      expect(res.status).toBe(200);
    });

    for (const role of ['admin', 'quality', 'operator', 'viewer']) {
      it(`POST /api/organization/members/:id/transfer-ownership : REFUSE ${role} (403)`, async () => {
        signedInAs(role);
        const res = await request(app).post('/api/organization/members/m1/transfer-ownership');
        expect(res.status).toBe(403);
      });
    }
  });
});
