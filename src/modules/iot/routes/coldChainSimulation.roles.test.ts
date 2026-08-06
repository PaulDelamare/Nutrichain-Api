import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const getSession = vi.fn();
const getFullOrganization = vi.fn();

// Le vrai requireOrgRole est exercé : c'est la liste des rôles autorisés (QUALITY_ROLES) qu'on
// teste ici. La mocker reviendrait à ne rien vérifier (cf. catalog.roles.test.ts).
vi.mock('../../identity/auth.config', () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSession(...args),
      getFullOrganization: (...args: unknown[]) => getFullOrganization(...args),
    },
  },
}));

// checkApiKey n'est pas le sujet : on le laisse passer pour atteindre la garde de rôle.
vi.mock('../../../shared/utils/checkApiKey/checkApiKey', () => ({
  checkApiKey: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../services/coldChainSimulation.service', () => ({
  coldChainSimulationService: {
    simulateIncident: vi.fn(async () => ({
      equipmentId: 'eq-1',
      sensorId: 'S',
      threshold: 4,
      peakTemp: 8,
      alertCreated: true,
      quarantinedCount: 1,
    })),
  },
}));

const { default: telemetryRoutes } = await import('./telemetry.routes');
const { globalErrorHandler } = await import('../../../shared/utils/errorHandler/errorHandler');
const { coldChainSimulationService } = await import('../services/coldChainSimulation.service');

const app = express();
app.use(express.json());
app.use('/api', telemetryRoutes);
app.use(globalErrorHandler);

function signedInAs(role: string): void {
  getSession.mockResolvedValue({
    user: { id: 'u-1' },
    session: { activeOrganizationId: 'org-1' },
  });
  getFullOrganization.mockResolvedValue({ id: 'org-1', members: [{ userId: 'u-1', role }] });
}

describe('POST /api/telemetry/simulate-incident — garde de rôle et câblage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuse l’opérateur : la simulation met des lots en quarantaine, c’est une décision qualité', async () => {
    signedInAs('operator');

    const res = await request(app).post('/api/telemetry/simulate-incident').send({});

    expect(res.status).toBe(403);
    expect(coldChainSimulationService.simulateIncident).not.toHaveBeenCalled();
  });

  it('refuse le viewer (lecture seule)', async () => {
    signedInAs('viewer');

    const res = await request(app).post('/api/telemetry/simulate-incident').send({});

    expect(res.status).toBe(403);
    expect(coldChainSimulationService.simulateIncident).not.toHaveBeenCalled();
  });

  it('autorise le contrôle qualité et appelle le service', async () => {
    signedInAs('quality');

    const res = await request(app).post('/api/telemetry/simulate-incident').send({});

    expect(res.status).toBe(200);
    expect(coldChainSimulationService.simulateIncident).toHaveBeenCalledWith({
      organizationId: 'org-1',
      equipmentId: undefined,
    });
  });

  it('autorise le propriétaire', async () => {
    signedInAs('owner');

    const res = await request(app).post('/api/telemetry/simulate-incident').send({});

    expect(res.status).toBe(200);
  });

  /**
   * ⚠️ Verrouille le CÂBLAGE de la validation sur la route, pas le schéma seul : un equipmentId
   * malformé doit être refusé en 400 AVANT d'atteindre le service. La garde de rôle passe d'abord
   * (quality), la validation ensuite.
   */
  it('un equipmentId malformé → 400, la validation est bien branchée', async () => {
    signedInAs('quality');

    const res = await request(app)
      .post('/api/telemetry/simulate-incident')
      .send({ equipmentId: 'pas-un-uuid' });

    expect(res.status).toBe(400);
    expect(res.body.error[0].field).toBe('equipmentId');
    expect(coldChainSimulationService.simulateIncident).not.toHaveBeenCalled();
  });
});
