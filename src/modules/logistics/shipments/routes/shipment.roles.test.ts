import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const getSession = vi.fn();
const getFullOrganization = vi.fn();

// On exerce le VRAI `sessionAuth`/`requireOrgRole` : ce qu'on teste, c'est la liste des rôles
// autorisés ET le fait que les middlewares soient réellement MONTÉS. Le test de route voisin mocke
// `sessionAuth`, il ne peut donc rien prouver de la garde.
vi.mock('../../../identity/auth.config', () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSession(...args),
      getFullOrganization: (...args: unknown[]) => getFullOrganization(...args),
    },
  },
}));

vi.mock('../controllers/shipment.controller', () => ({
  createShipmentController: (_req: express.Request, res: express.Response) => res.status(201).end(),
  confirmDeliveryController: (_req: express.Request, res: express.Response) => res.status(200).end(),
}));

const { default: shipmentRoutes } = await import('./shipment.routes');
const { globalErrorHandler } = await import('../../../../shared/utils/errorHandler/errorHandler');

const app = express();
app.use(express.json());
app.use('/api', shipmentRoutes);
app.use(globalErrorHandler);

function signedInAs(role: string): void {
  getSession.mockResolvedValue({
    user: { id: 'u-1' },
    session: { activeOrganizationId: 'org-1' },
  });
  getFullOrganization.mockResolvedValue({ id: 'org-1', members: [{ userId: 'u-1', role }] });
}

const EXPEDITION = '22222222-2222-4222-8222-222222222222';
const url = `/api/logistics/shipments/${EXPEDITION}/delivered`;

beforeEach(() => vi.clearAllMocks());

describe('RBAC et câblage de la confirmation de livraison', () => {
  it.each(['owner', 'admin', 'operator'])('autorise %s', async (role) => {
    signedInAs(role);
    const res = await request(app).post(url).send({});
    expect(res.status).toBe(200);
  });

  it('refuse viewer (lecture seule)', async () => {
    signedInAs('viewer');
    const res = await request(app).post(url).send({});
    expect(res.status).toBe(403);
  });

  // Constater une arrivée est de la manutention, pas une décision sanitaire — même arbitrage que
  // pour la palettisation. Sans ce cas, élargir la garde à ALL_ROLES ne ferait rougir que viewer.
  it('refuse quality : constater une arrivée n’est pas une décision qualité', async () => {
    signedInAs('quality');
    const res = await request(app).post(url).send({});
    expect(res.status).toBe(403);
  });

  it('refuse (401) sans session', async () => {
    getSession.mockResolvedValue(null);
    const res = await request(app).post(url).send({});
    expect(res.status).toBe(401);
  });

  // Preuve que la validation est MONTÉE : sans elle, un identifiant quelconque atteindrait la base
  // et rendrait 404 au lieu de 400.
  it('refuse (400) un identifiant qui n’est pas un uuid', async () => {
    signedInAs('operator');
    const res = await request(app).post('/api/logistics/shipments/exp-1/delivered').send({});
    expect(res.status).toBe(400);
  });

  it('refuse (400) une date de livraison qui n’est pas une date', async () => {
    signedInAs('operator');
    const res = await request(app).post(url).send({ date_livraison: 'hier' });
    expect(res.status).toBe(400);
  });

  it('accepte un corps vide : la date est optionnelle', async () => {
    signedInAs('operator');
    const res = await request(app).post(url).send({});
    expect(res.status).toBe(200);
  });

  // La création reste servie par SA chaîne : un corps vide y tombe sur SA validation (400), et non
  // sur un 404 ou sur le contrôleur de livraison.
  it('n’avale pas la création d’expédition', async () => {
    signedInAs('operator');
    const res = await request(app).post('/api/logistics/shipments').send({});
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('shipment_id');
  });
});
