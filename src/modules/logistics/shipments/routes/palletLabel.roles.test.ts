import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const getSession = vi.fn();
const getFullOrganization = vi.fn();

/**
 * Les autres tests de ces routes mockent `sessionAuth` : ils ne verraient donc AUCUNE régression
 * de garde. Ici on exerce le vrai middleware — c'est la liste de rôles et l'exigence de session
 * qu'on teste, pas la logique métier.
 */
vi.mock('../../../identity/auth.config', () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSession(...args),
      getFullOrganization: (...args: unknown[]) => getFullOrganization(...args),
    },
  },
}));

vi.mock('../controllers/palletLabel.controller', () => ({
  getPalletLabelController: (_req: express.Request, res: express.Response) => res.status(200).end(),
  resolvePalletController: (_req: express.Request, res: express.Response) => res.status(200).end(),
}));
vi.mock('../controllers/shipment.controller', () => ({
  createShipmentController: (_req: express.Request, res: express.Response) => res.status(200).end(),
}));
vi.mock('../middlewares/validateShipment.middleware', () => ({
  validateShipmentParams: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
}));
vi.mock('../middlewares/validatePalletScan.middleware', () => ({
  validatePalletScan: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
}));

const { default: shipmentRoutes } = await import('./shipment.routes');
const { globalErrorHandler } = await import('../../../../shared/utils/errorHandler/errorHandler');

const app = express();
app.use(express.json());
app.use('/api', shipmentRoutes);
app.use(globalErrorHandler);

const SSCC = '034567890000000422';

function signedInAs(role: string): void {
  getSession.mockResolvedValue({
    user: { id: 'u-1' },
    session: { activeOrganizationId: 'org-1' },
  });
  getFullOrganization.mockResolvedValue({ id: 'org-1', members: [{ userId: 'u-1', role }] });
}

beforeEach(() => vi.clearAllMocks());

describe('RBAC des routes de palette (session réelle)', () => {
  describe('GET /logistics/shipments/:id/label', () => {
    it.each(['owner', 'admin', 'operator', 'quality', 'viewer'])(
      'autorise %s — imprimer une étiquette est une lecture métier',
      async (role) => {
        signedInAs(role);
        const res = await request(app).get('/api/logistics/shipments/exp-1/label');
        expect(res.status).toBe(200);
      }
    );

    it('refuse sans session', async () => {
      getSession.mockResolvedValue(null);
      const res = await request(app).get('/api/logistics/shipments/exp-1/label');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /logistics/shipments/by-sscc/:sscc', () => {
    it.each(['owner', 'admin', 'operator', 'quality', 'viewer'])('autorise %s', async (role) => {
      signedInAs(role);
      const res = await request(app).get(`/api/logistics/shipments/by-sscc/${SSCC}`);
      expect(res.status).toBe(200);
    });

    // Le contenu d'une palette — client, produits, quantités — n'est PAS un canal public,
    // contrairement au scan consommateur qui, lui, ne montre que ce qui concerne l'acheteur.
    it('refuse sans session : une palette n est pas un canal public', async () => {
      getSession.mockResolvedValue(null);
      const res = await request(app).get(`/api/logistics/shipments/by-sscc/${SSCC}`);
      expect(res.status).toBe(401);
    });
  });
});
