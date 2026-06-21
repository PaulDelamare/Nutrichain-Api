import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../../shared/configs/prismaClient.config', () => {
  const prisma = {
    ePCIS_Event: { findMany: vi.fn().mockResolvedValue([]) },
    unit: { findMany: vi.fn().mockResolvedValue([{ code: 'L' }]) },
    product: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  return { prisma, bdd: prisma };
});

import { app } from '../../../app';

const PRODUCT_CSV =
  'nom,code_gtin,categorie,duree_conservation_defaut,seuil_alerte_stock,unite_reference\n' +
  'Lait,3001234567890,Frais,30,10,L';

describe('Connector routes (mixedAuth + CSV)', () => {
  beforeEach(() => {
    process.env.API_KEY = 'test-key';
    process.env.API_KEY_ORG_ID = 'org-test';
  });

  it('export sans auth → rejeté par la garde multi-tenant', async () => {
    const res = await request(app).get('/api/connectors/exports/events');
    expect([401, 403]).toContain(res.status);
  });

  it('export EPCIS avec clé API → 200 + CSV (Content-Type text/csv)', async () => {
    const res = await request(app)
      .get('/api/connectors/exports/events')
      .set('x-api-key', 'test-key');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('event_time,event_type,related_entity,related_id,payload');
  });

  it('import produits (CSV) avec clé API → 200 + rapport', async () => {
    const res = await request(app)
      .post('/api/connectors/imports/products')
      .set('x-api-key', 'test-key')
      .set('Content-Type', 'text/csv')
      .send(PRODUCT_CSV);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 1, created: 1, errors: 0 });
  });

  it('import avec corps vide → 400', async () => {
    const res = await request(app)
      .post('/api/connectors/imports/products')
      .set('x-api-key', 'test-key')
      .set('Content-Type', 'text/csv')
      .send('');

    expect(res.status).toBe(400);
  });
});
