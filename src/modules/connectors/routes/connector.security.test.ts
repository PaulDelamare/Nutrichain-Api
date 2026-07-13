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

/**
 * Les gardes RÉELLES sont exercées ici — aucun middleware n'est simulé.
 *
 * Trois tests de ce module affirmaient l'inverse : « import produits avec clé API → 200 ». Ils
 * étaient verts, et ils certifiaient qu'une clé — publique, embarquée dans le bundle mobile et
 * commitée dans un dépôt public — suffisait à réécrire le catalogue et le fichier clients.
 * Un test qui codifie une vulnérabilité la rend éternelle : personne ne la corrigera tant qu'il
 * sera vert.
 */
describe('Connecteurs — la clé API seule n’autorise aucune écriture', () => {
  beforeEach(() => {
    process.env.API_KEY = 'test-key';
    process.env.API_KEY_ORG_ID = 'org-test';
  });

  it('refuse l’import du catalogue présenté avec la seule clé API', async () => {
    const res = await request(app)
      .post('/api/connectors/imports/products')
      .set('x-api-key', 'test-key')
      .set('Content-Type', 'text/csv')
      .send(PRODUCT_CSV);

    expect(res.status).toBe(401);
  });

  it('refuse l’import du fichier clients présenté avec la seule clé API', async () => {
    const res = await request(app)
      .post('/api/connectors/imports/customers')
      .set('x-api-key', 'test-key')
      .set('Content-Type', 'text/csv')
      .send('nom_enseigne,email\nCarrefour,contact@example.com');

    expect(res.status).toBe(401);
  });

  it('refuse l’export des événements EPCIS présenté avec la seule clé API', async () => {
    const res = await request(app)
      .get('/api/connectors/exports/events')
      .set('x-api-key', 'test-key');

    expect(res.status).toBe(401);
  });

  it('refuse une requête sans aucune authentification', async () => {
    const res = await request(app).get('/api/connectors/exports/events');
    expect([401, 403]).toContain(res.status);
  });
});
