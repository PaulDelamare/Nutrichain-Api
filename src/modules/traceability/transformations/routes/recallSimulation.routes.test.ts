import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const getSession = vi.fn();
const getFullOrganization = vi.fn();
const simulateRecall = vi.fn();

// Le vrai `requireOrgRole` et le vrai middleware de validation sont exercés : les mocker
// reviendrait à tester le montage des mocks. Plusieurs défauts de ce dépôt venaient d'une garde
// écrite mais jamais branchée sur la route.
vi.mock('../../../identity/auth.config', () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSession(...args),
      getFullOrganization: (...args: unknown[]) => getFullOrganization(...args),
    },
  },
}));

vi.mock('../services/recall.service', () => ({
  recallService: {
    simulateRecall: (...args: unknown[]) => simulateRecall(...args),
    triggerRecall: vi.fn(),
  },
}));

const { default: transformationRoutes } = await import('./transformation.routes');
const { globalErrorHandler } = await import('../../../../shared/utils/errorHandler/errorHandler');

const app = express();
app.use(express.json());
app.use('/api', transformationRoutes);
app.use(globalErrorHandler);

const batchId = '11111111-1111-4111-8111-111111111111';
const url = `/api/traceability/batches/${batchId}/recall-simulation`;

function signedInAs(role: string): void {
  getSession.mockResolvedValue({
    user: { id: 'u-1' },
    session: { activeOrganizationId: 'org-1' },
  });
  getFullOrganization.mockResolvedValue({ id: 'org-1', members: [{ userId: 'u-1', role }] });
}

describe('GET /api/traceability/batches/:id/recall-simulation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    simulateRecall.mockResolvedValue({
      impactedCount: 1,
      impactedBatchIds: [batchId],
      impactedBatchIdsTruncated: false,
      affectedShipments: [],
      depthSaturated: false,
    });
  });

  it('autorise la lecture seule, jusqu au rôle le plus faible', async () => {
    // Le rappel réel est en QUALITY_ROLES. Aligner la simulation dessus fermerait l'écran au
    // `viewer` et à l'`operator`, alors que l'entrée de menu leur reste visible.
    signedInAs('viewer');

    const response = await request(app).get(url);

    expect(response.status).toBe(200);
  });

  it('refuse un rôle hors référentiel', async () => {
    signedInAs('stagiaire_curieux');

    const response = await request(app).get(url);

    expect(response.status).toBe(403);
  });

  it('refuse une requête sans session', async () => {
    getSession.mockResolvedValue(null);

    const response = await request(app).get(url);

    expect(response.status).toBe(401);
  });

  it('rejette un identifiant de lot hors format', async () => {
    signedInAs('quality');

    const response = await request(app).get('/api/traceability/batches/pas-un-uuid/recall-simulation');

    expect(response.status).toBe(400);
    expect(simulateRecall).not.toHaveBeenCalled();
  });

  it("prend l'organisation dans la session, jamais dans la requête", async () => {
    signedInAs('operator');

    await request(app).get(`${url}?organizationId=org-pirate`);

    expect(simulateRecall).toHaveBeenCalledWith(batchId, 'org-1');
  });

  it('interdit la mise en cache de la réponse', async () => {
    // Le résultat dépend de l'état mutable des lots : un intermédiaire qui le garderait servirait
    // un impact périmé au moment d'une décision sanitaire.
    signedInAs('viewer');

    const response = await request(app).get(url);

    expect(response.headers['cache-control']).toBe('no-store');
  });
});
