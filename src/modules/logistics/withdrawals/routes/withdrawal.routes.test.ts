import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const getSession = vi.fn();
const getFullOrganization = vi.fn();
const recordWithdrawal = vi.fn();
const listWithdrawalsByCustomer = vi.fn();

// Les vraies gardes sont exercées : les mocker reviendrait à tester le montage des mocks.
vi.mock('../../../identity/auth.config', () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSession(...args),
      getFullOrganization: (...args: unknown[]) => getFullOrganization(...args),
    },
  },
}));

vi.mock('../services/withdrawal.service', () => ({
  withdrawalService: {
    recordWithdrawal: (...args: unknown[]) => recordWithdrawal(...args),
    listWithdrawalsByCustomer: (...args: unknown[]) => listWithdrawalsByCustomer(...args),
  },
}));

const { default: withdrawalRoutes } = await import('./withdrawal.routes');
const { globalErrorHandler } = await import('../../../../shared/utils/errorHandler/errorHandler');

const app = express();
app.use(express.json());
app.use('/api', withdrawalRoutes);
app.use(globalErrorHandler);

const batchId = '11111111-1111-4111-8111-111111111111';
const customerId = '22222222-2222-4222-8222-222222222222';
const url = `/api/logistics/batches/${batchId}/withdrawals`;

const payload = {
  id_client: customerId,
  quantite: 10,
  motif: 'Rappel produit — retrait du rayon',
};

function signedInAs(role: string): void {
  getSession.mockResolvedValue({
    user: { id: 'u-1' },
    session: { activeOrganizationId: 'org-1' },
  });
  getFullOrganization.mockResolvedValue({ id: 'org-1', members: [{ userId: 'u-1', role }] });
}

beforeEach(() => {
  vi.clearAllMocks();
  recordWithdrawal.mockResolvedValue({
    id: 'retrait-1',
    quantiteLivree: '40',
    quantiteRetiree: '10',
    resteARetirer: '30',
    unite: 'KG',
  });
  listWithdrawalsByCustomer.mockResolvedValue([]);
});

describe('POST /api/logistics/batches/:id/withdrawals', () => {
  it('autorise le contrôle qualité, qui conduit le rappel', async () => {
    signedInAs('quality');

    const response = await request(app).post(url).send(payload);

    expect(response.status).toBe(201);
  });

  it("autorise l'opérateur, qui prend l'appel du magasin", async () => {
    signedInAs('operator');

    const response = await request(app).post(url).send(payload);

    expect(response.status).toBe(201);
  });

  it('refuse le rôle en lecture seule', async () => {
    signedInAs('viewer');

    const response = await request(app).post(url).send(payload);

    expect(response.status).toBe(403);
    expect(recordWithdrawal).not.toHaveBeenCalled();
  });

  it('refuse une requête sans session', async () => {
    getSession.mockResolvedValue(null);

    const response = await request(app).post(url).send(payload);

    expect(response.status).toBe(401);
  });

  it("prend l'organisation et l'auteur dans la session, jamais dans le corps", async () => {
    signedInAs('operator');

    await request(app)
      .post(url)
      .send({ ...payload, organization_id: 'org-pirate', retire_par: 'u-usurpee' });

    expect(recordWithdrawal).toHaveBeenCalledWith(batchId, 'org-1', 'u-1', {
      id_client: customerId,
      quantite: 10,
      motif: payload.motif,
      constate_aupres_de: undefined,
    });
  });

  it("n'accepte pas d'unité dans le corps : elle vient du lot", async () => {
    signedInAs('operator');

    await request(app).post(url).send({ ...payload, unite: 'G' });

    const recu = recordWithdrawal.mock.calls[0][3] as Record<string, unknown>;
    expect(recu).not.toHaveProperty('unite');
  });

  it('rejette une quantité nulle ou négative', async () => {
    signedInAs('operator');

    const zero = await request(app).post(url).send({ ...payload, quantite: 0 });
    const negative = await request(app).post(url).send({ ...payload, quantite: -5 });

    expect(zero.status).toBe(400);
    expect(negative.status).toBe(400);
    expect(recordWithdrawal).not.toHaveBeenCalled();
  });

  it('exige un motif, et le borne', async () => {
    signedInAs('operator');

    const sansMotif = await request(app).post(url).send({ ...payload, motif: undefined });
    const tropLong = await request(app)
      .post(url)
      .send({ ...payload, motif: 'x'.repeat(501) });

    expect(sansMotif.status).toBe(400);
    expect(tropLong.status).toBe(400);
  });

  it('rejette un identifiant de lot hors format', async () => {
    signedInAs('operator');

    const response = await request(app)
      .post('/api/logistics/batches/pas-un-uuid/withdrawals')
      .send(payload);

    expect(response.status).toBe(400);
  });
});

describe('GET /api/logistics/batches/:id/withdrawals', () => {
  it("ouvre l'avancement à tous les rôles, y compris en lecture seule", async () => {
    signedInAs('viewer');

    const response = await request(app).get(url);

    expect(response.status).toBe(200);
    expect(listWithdrawalsByCustomer).toHaveBeenCalledWith(batchId, 'org-1');
  });

  it('interdit la mise en cache : le reste à retirer change à chaque déclaration', async () => {
    signedInAs('viewer');

    const response = await request(app).get(url);

    expect(response.headers['cache-control']).toBe('no-store');
  });
});
