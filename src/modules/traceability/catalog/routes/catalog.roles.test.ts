import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const getSession = vi.fn();
const getFullOrganization = vi.fn();

// Le vrai requireOrgRole est exercé : c'est la liste des rôles autorisés qu'on teste ici,
// et la mocker (comme le fait catalog.routes.test.ts) reviendrait à ne rien vérifier.
vi.mock('../../../identity/auth.config', () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSession(...args),
      getFullOrganization: (...args: unknown[]) => getFullOrganization(...args),
    },
  },
}));

vi.mock('../services/catalog.service', () => ({
  catalogService: {
    getAllProducts: vi.fn(async () => []),
    getAllBatches: vi.fn(async () => []),
  },
}));

const { default: catalogRoutes } = await import('./catalog.routes');
const { globalErrorHandler } = await import('../../../../shared/utils/errorHandler/errorHandler');

const app = express();
app.use(express.json());
app.use('/api', catalogRoutes);
app.use(globalErrorHandler);

function signedInAs(role: string): void {
  getSession.mockResolvedValue({
    user: { id: 'u-1' },
    session: { activeOrganizationId: 'org-1' },
  });
  getFullOrganization.mockResolvedValue({ id: 'org-1', members: [{ userId: 'u-1', role }] });
}

describe('accès au catalogue par rôle', () => {
  beforeEach(() => vi.clearAllMocks());

  it("autorise l'opérateur, la persona de l'application mobile", async () => {
    // Il doit choisir un produit pour saisir une réception (opération que /api/sync/scans
    // lui accorde). Un 403 ici rendrait la réception impossible sur le terrain.
    signedInAs('operator');

    const response = await request(app).get('/api/traceability/products');

    expect(response.status).toBe(200);
  });

  it('autorise le contrôle qualité', async () => {
    signedInAs('quality');

    const response = await request(app).get('/api/traceability/batches');

    expect(response.status).toBe(200);
  });

  it("autorise les rôles d'organisation", async () => {
    signedInAs('owner');

    const response = await request(app).get('/api/traceability/products');

    expect(response.status).toBe(200);
  });

  it('refuse un rôle inconnu', async () => {
    signedInAs('stagiaire_curieux');

    const response = await request(app).get('/api/traceability/products');

    expect(response.status).toBe(403);
  });

  it('refuse une requête sans session', async () => {
    getSession.mockResolvedValue(null);

    const response = await request(app).get('/api/traceability/products');

    expect(response.status).toBe(401);
  });
});
