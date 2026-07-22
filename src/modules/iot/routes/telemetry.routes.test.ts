import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../../app';
import { prisma } from '../../../shared/configs/prismaClient.config';

// On NE mocke PAS machineAuth : ce test prouve le rejet RÉEL de la garde multi-tenant centralisée
// au niveau HTTP (le rejet survient avant le controller). Seule la base est simulée.
vi.mock('../../../shared/configs/prismaClient.config', () => {
  const mock = { iotGateway: { findFirst: vi.fn() } };
  return { prisma: mock, bdd: mock };
});

const trame = { sensor_id: 'S', temperature: 4, humidity: 50, battery_level: 80 };

describe('POST /api/telemetry/ping — garde multi-tenant réelle (machineAuth)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // La clé du .env n'ouvre plus rien par elle-même : seule une passerelle enregistrée le peut.
    process.env.IOT_API_KEY = 'cle-env';
    process.env.API_KEY_ORG_ID = 'org-du-env';
  });

  it("clé non enregistrée comme passerelle → 401, même si c'est celle du .env", async () => {
    vi.mocked(prisma.iotGateway.findFirst).mockResolvedValue(null as never);

    const res = await request(app).post('/api/telemetry/ping').set('x-api-key', 'cle-env').send(trame);

    expect(res.status).toBe(401);
  });

  it('aucune clé → 401', async () => {
    const res = await request(app).post('/api/telemetry/ping').send(trame);

    expect(res.status).toBe(401);
    expect(prisma.iotGateway.findFirst).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ Ce test verrouille le CÂBLAGE, pas le schéma : c'est l'absence de middleware sur la route
   * qui a laissé passer des trames non numériques (#145). Un test de middleware isolé, ou un
   * contrôleur à qui l'on pose la trame validée à la main, reste vert si on débranche la route.
   */
  it('passerelle valide + trame non numérique → 400 : la validation est bien branchée', async () => {
    vi.mocked(prisma.iotGateway.findFirst).mockResolvedValue({
      id: 'gw-1',
      organization_id: 'org-1',
    } as never);

    const res = await request(app)
      .post('/api/telemetry/ping')
      .set('x-api-key', 'cle-env')
      .send({ ...trame, temperature: 'n/a' });

    expect(res.status).toBe(400);
    expect(res.body.error[0].field).toBe('temperature');
  });

  it("l'authentification passe AVANT la validation : trame invalide sans clé → 401, pas 400", async () => {
    const res = await request(app)
      .post('/api/telemetry/ping')
      .send({ ...trame, temperature: true });

    expect(res.status).toBe(401);
  });
});
