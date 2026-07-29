import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { globalErrorHandler } from '../../../../shared/utils/errorHandler/errorHandler';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    batch: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../services/genealogy.service', () => ({
  genealogyService: {
    getUpstream: vi.fn().mockResolvedValue([]),
    getOrigins: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../../identity/middlewares/requireAuth.middleware', () => ({
  requireAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}));
vi.mock('../../../identity/middlewares/requireOrgRole.middleware', () => ({
  requireOrgRole:
    () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
}));

import transformationRouter from '../routes/transformation.routes';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { genealogyService } from '../services/genealogy.service';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api', transformationRouter);
  app.use(globalErrorHandler);
  return app;
};

const buildBatch = (overrides: Record<string, unknown> = {}) => ({
  id: 'batch-1',
  organization_id: 'org-1',
  lot_number: '260704-ABC123',
  statut: 'EXPEDIE',
  date_peremption: new Date('2027-01-01'),
  produit: { nom: 'Yaourt nature', code_gtin: '1234567890' },
  organization: { name: 'Ferme Bio' },
  ...overrides,
});

describe('publicScanBatch controller (route publique B2C — Sec C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('doit refuser (404) un lot non encore expédié (statut EN_STOCK)', async () => {
    vi.mocked(prisma.batch.findMany).mockResolvedValue([]);

    const res = await request(buildApp()).get('/api/public/scan/batch-1');

    expect(res.status).toBe(404);
  });

  it('doit accepter (200) un lot EXPEDIE et exposer un payload limité', async () => {
    vi.mocked(prisma.batch.findMany).mockResolvedValue([buildBatch({ statut: 'EXPEDIE' })]);

    const res = await request(buildApp()).get('/api/public/scan/batch-1');

    expect(res.status).toBe(200);
    expect(res.body.data.lot.nom_produit).toBe('Yaourt nature');
    expect(res.body.data.lot.numero_lot).toBe('260704-ABC123');
    expect(res.body.data.lot.statut_sanitaire).toBe('CONFORME');
    expect(res.body.data.lot).not.toHaveProperty('organization_id');
    expect(res.body.data.lot).not.toHaveProperty('quantite_actuelle');
    expect(res.body.data.trace.origines).toEqual([]);
  });

  it('expose le nom de la ferme d’origine, sans contact ni adresse', async () => {
    vi.mocked(prisma.batch.findMany).mockResolvedValue([buildBatch()]);
    vi.mocked(genealogyService.getOrigins).mockResolvedValue([
      {
        lot_number: 'LAIT-001',
        date_reception: new Date('2026-07-01'),
        fournisseur: { id: 'sup-secret', nom_ferme: 'Ferme Les Aubépines' },
      },
    ]);

    const res = await request(buildApp()).get('/api/public/scan/batch-1');

    expect(res.status).toBe(200);
    expect(res.body.data.trace.origines).toEqual([{ ferme: 'Ferme Les Aubépines' }]);
    expect(res.body.data.trace.message).toContain('Ferme Les Aubépines');
    expect(JSON.stringify(res.body.data)).not.toContain('sup-secret');
    expect(JSON.stringify(res.body.data)).not.toContain('contact');
    expect(JSON.stringify(res.body.data)).not.toContain('adresse');
  });

  it('déduplique les fermes quand plusieurs lots racines partagent le même fournisseur', async () => {
    vi.mocked(prisma.batch.findMany).mockResolvedValue([buildBatch()]);
    vi.mocked(genealogyService.getOrigins).mockResolvedValue([
      {
        lot_number: 'L1',
        date_reception: new Date('2026-07-01'),
        fournisseur: { id: 's1', nom_ferme: 'Ferme du Val' },
      },
      {
        lot_number: 'L2',
        date_reception: new Date('2026-07-02'),
        fournisseur: { id: 's1', nom_ferme: 'Ferme du Val' },
      },
      {
        lot_number: 'L3',
        date_reception: new Date('2026-07-03'),
        fournisseur: { id: 's2', nom_ferme: 'Ferme des Prés' },
      },
    ]);

    const res = await request(buildApp()).get('/api/public/scan/batch-1');

    expect(res.body.data.trace.origines).toEqual([
      { ferme: 'Ferme du Val' },
      { ferme: 'Ferme des Prés' },
    ]);
  });

  it('doit résoudre le lot par son numéro de lot GS1 (celui du Digital Link imprimé)', async () => {
    vi.mocked(prisma.batch.findMany).mockResolvedValue([buildBatch()]);

    const res = await request(buildApp()).get('/api/public/scan/260704-ABC123');

    expect(res.status).toBe(200);
    expect(prisma.batch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ id: '260704-ABC123' }, { lot_number: '260704-ABC123' }],
        }),
      })
    );
  });

  it('doit accepter (200) un lot ALERTE et signaler RAPPEL_CONSOMMATEUR', async () => {
    vi.mocked(prisma.batch.findMany).mockResolvedValue([buildBatch({ statut: 'ALERTE' })]);

    const res = await request(buildApp()).get('/api/public/scan/batch-1');

    expect(res.status).toBe(200);
    expect(res.body.data.lot.statut_sanitaire).toBe('RAPPEL_CONSOMMATEUR');
  });

  it('collision de lot_number inter-org : le RAPPEL prime sur l’homonyme conforme', async () => {
    // Le cœur de #121 : deux organisations ont le même lot_number « LOT001 », l'une EXPEDIE
    // (conforme), l'autre sous rappel. Le consommateur doit voir le RAPPEL, jamais le conforme.
    vi.mocked(prisma.batch.findMany).mockResolvedValue([
      buildBatch({ id: 'b-ok', organization_id: 'org-1', statut: 'EXPEDIE' }),
      buildBatch({
        id: 'b-recall',
        organization_id: 'org-2',
        statut: 'ALERTE',
        organization: { name: 'Producteur Rappelé' },
      }),
    ]);

    const res = await request(buildApp()).get('/api/public/scan/LOT001');

    expect(res.status).toBe(200);
    expect(res.body.data.lot.statut_sanitaire).toBe('RAPPEL_CONSOMMATEUR');
    expect(res.body.data.lot.producteur).toBe('Producteur Rappelé');
  });

  it('collision de lot_number inter-org sans rappel : 409 plutôt qu’un producteur au hasard', async () => {
    vi.mocked(prisma.batch.findMany).mockResolvedValue([
      buildBatch({ id: 'b-1', organization_id: 'org-1', statut: 'EXPEDIE' }),
      buildBatch({ id: 'b-2', organization_id: 'org-2', statut: 'EXPEDIE' }),
    ]);

    const res = await request(buildApp()).get('/api/public/scan/LOT001');

    expect(res.status).toBe(409);
  });
});

describe('publicScanDigitalLink controller (GS1 Digital Link — GTIN + lot, #139)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Avant #139, ce lien ne correspondait à AUCUNE route montée : le QR imprimé sur chaque
  // étiquette (labelService.generateDigitalLink) était un lien mort. Ce test verrouille le câblage
  // réel (route → middleware → contrôleur), pas seulement la logique de résolution en isolation.
  it('doit résoudre le lot par la PAIRE (gtin, lot) — le lien réellement imprimé', async () => {
    vi.mocked(prisma.batch.findMany).mockResolvedValue([buildBatch()]);

    const res = await request(buildApp()).get('/api/gs1/01/1234567890/10/260704-ABC123');

    expect(res.status).toBe(200);
    expect(res.body.data.lot.nom_produit).toBe('Yaourt nature');
    expect(prisma.batch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          lot_number: '260704-ABC123',
          produit: { code_gtin: '1234567890' },
        }),
      })
    );
  });

  // Le consommateur qui scanne recoit une PAGE ; l ERP qui interroge la meme URL recoit du JSON.
  // Une seule adresse, deux publics : c est ce que prevoit GS1 Digital Link, et c est ce qui
  // manquait — le scan renvoyait des accolades devant quelqu un qui tient un pot de yaourt (#285).
  it('rend une PAGE quand un navigateur scanne (Accept: text/html)', async () => {
    vi.mocked(prisma.batch.findMany).mockResolvedValue([buildBatch()]);

    const res = await request(buildApp())
      .get('/api/gs1/01/1234567890/10/260704-ABC123')
      .set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Yaourt nature');
    expect(res.text).not.toContain('"status":200');
  });

  it('rend du JSON a une machine (Accept: application/json), comportement inchange', async () => {
    vi.mocked(prisma.batch.findMany).mockResolvedValue([buildBatch()]);

    const res = await request(buildApp())
      .get('/api/gs1/01/1234567890/10/260704-ABC123')
      .set('Accept', 'application/json');

    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.data.lot.nom_produit).toBe('Yaourt nature');
  });

  // curl, une douchette, un client sans preference : ils envoient */*. Leur servir du HTML
  // casserait des integrations existantes — le JSON reste le defaut.
  it('rend du JSON quand le client n exprime aucune preference (*/*)', async () => {
    vi.mocked(prisma.batch.findMany).mockResolvedValue([buildBatch()]);

    const res = await request(buildApp())
      .get('/api/gs1/01/1234567890/10/260704-ABC123')
      .set('Accept', '*/*');

    expect(res.headers['content-type']).toContain('application/json');
  });

  it('affiche l alerte de rappel dans la page quand le lot est en ALERTE', async () => {
    vi.mocked(prisma.batch.findMany).mockResolvedValue([buildBatch({ statut: 'ALERTE' })]);

    const res = await request(buildApp())
      .get('/api/gs1/01/1234567890/10/260704-ABC123')
      .set('Accept', 'text/html');

    expect(res.text).toContain('Ne pas consommer');
  });

  it('normalise le lot en MAJUSCULES avant la requête (comme au stockage, receipt.service.ts)', async () => {
    // `lot_number` est toujours stocké en majuscules. Un lot transmis en minuscule (tapé à la
    // main, ou une URL réécrite par un intermédiaire) doit quand même trouver le lot — sinon
    // c'est un 404 silencieux sur un scan pourtant valide.
    vi.mocked(prisma.batch.findMany).mockResolvedValue([buildBatch()]);

    const res = await request(buildApp()).get('/api/gs1/01/1234567890/10/260704-abc123');

    expect(res.status).toBe(200);
    expect(prisma.batch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ lot_number: '260704-ABC123' }),
      })
    );
  });

  it('renvoie un message spécifique (pas « code incomplet ») sur une collision GTIN+lot', async () => {
    // Contrairement à `/public/scan/:id`, ce canal a déjà reçu la paire complète : redemander de
    // « scanner le code GS1 complet » n'aurait aucun sens ici.
    vi.mocked(prisma.batch.findMany).mockResolvedValue([
      buildBatch({ id: 'b-1', organization_id: 'org-1', statut: 'EXPEDIE' }),
      buildBatch({ id: 'b-2', organization_id: 'org-2', statut: 'EXPEDIE' }),
    ]);

    const res = await request(buildApp()).get('/api/gs1/01/1234567890/10/LOT001');

    expect(res.status).toBe(409);
    expect(res.body.error[0].message).not.toContain('code GS1 complet');
  });

  it('refuse (400) un GTIN hors format, avant toute requête Prisma', async () => {
    const res = await request(buildApp()).get('/api/gs1/01/pas-un-gtin/10/LOT001');

    expect(res.status).toBe(400);
    expect(prisma.batch.findMany).not.toHaveBeenCalled();
  });

  it('refuse (400) un lot hors format (caractère interdit)', async () => {
    const res = await request(buildApp()).get('/api/gs1/01/1234567890/10/LOT%2F001');

    expect(res.status).toBe(400);
    expect(prisma.batch.findMany).not.toHaveBeenCalled();
  });

  it('doit refuser (404) si aucun lot ne correspond à la paire', async () => {
    vi.mocked(prisma.batch.findMany).mockResolvedValue([]);

    const res = await request(buildApp()).get('/api/gs1/01/1234567890/10/LOT001');

    expect(res.status).toBe(404);
  });

  it('conserve le rappel-prioritaire même sur la paire GTIN+lot (coïncidence entre deux org)', async () => {
    vi.mocked(prisma.batch.findMany).mockResolvedValue([
      buildBatch({ id: 'b-ok', organization_id: 'org-1', statut: 'EXPEDIE' }),
      buildBatch({
        id: 'b-recall',
        organization_id: 'org-2',
        statut: 'ALERTE',
        organization: { name: 'Producteur Rappelé' },
      }),
    ]);

    const res = await request(buildApp()).get('/api/gs1/01/1234567890/10/LOT001');

    expect(res.status).toBe(200);
    expect(res.body.data.lot.statut_sanitaire).toBe('RAPPEL_CONSOMMATEUR');
  });
});
