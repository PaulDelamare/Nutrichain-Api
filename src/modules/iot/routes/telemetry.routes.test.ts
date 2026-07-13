import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../../app';

// On NE mocke PAS machineAuth/checkApiKey : ce test prouve le rejet RÉEL de la garde
// multi-tenant centralisée au niveau HTTP (le rejet survient avant le controller).
vi.mock('../../../shared/configs/prismaClient.config', () => {
  const mock = {};
  return { prisma: mock, bdd: mock };
});

describe('POST /api/telemetry/ping — garde multi-tenant réelle (machineAuth)', () => {
  beforeEach(() => {
    process.env.API_KEY = 'test-key';
    delete process.env.API_KEY_ORG_ID;
  });

  it('clé API valide mais aucune organisation bornée → 401 (pas de bypass cross-tenant)', async () => {
    const res = await request(app)
      .post('/api/telemetry/ping')
      .set('x-api-key', 'test-key')
      .send({ sensor_id: 'S', temperature: 4, humidity: 50, battery_level: 80 });

    expect(res.status).toBe(401);
  });
});
