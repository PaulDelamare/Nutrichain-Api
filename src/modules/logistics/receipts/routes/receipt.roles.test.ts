import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const getSession = vi.fn();
const getFullOrganization = vi.fn();

// On exerce le VRAI sessionAuth/requireOrgRole : c'est la liste des rôles autorisés
// (WRITE_ROLES / QUALITY_ROLES) qu'on teste. Les autres tests de ces routes mockent
// sessionAuth et ne détecteraient donc aucune régression RBAC — d'où ce fichier dédié.
vi.mock('../../../identity/auth.config', () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSession(...args),
      getFullOrganization: (...args: unknown[]) => getFullOrganization(...args),
    },
  },
}));

// Contrôleurs et middlewares en aval mockés : on isole la garde de rôle.
vi.mock('../controllers/receipt.controller', () => ({
  createReceiptController: (_req: express.Request, res: express.Response) => res.status(200).end(),
  getReceiptStatsController: (_req: express.Request, res: express.Response) =>
    res.status(200).end(),
  getReceiptByIdController: (_req: express.Request, res: express.Response) => res.status(200).end(),
  // Ces deux-là se distinguent : `/batches/resolve` et `/batches/:id` se disputent la même URL, et
  // seul l'ordre d'enregistrement les départage.
  getBatchByIdController: (_req: express.Request, res: express.Response) =>
    res.status(200).json({ route: 'byId' }),
  getBatchLabelController: (_req: express.Request, res: express.Response) => res.status(200).end(),
  listReceiptsController: (_req: express.Request, res: express.Response) => res.status(200).end(),
  liftBatchQuarantineController: (_req: express.Request, res: express.Response) =>
    res.status(200).end(),
  liftQualityQuarantineController: (_req: express.Request, res: express.Response) =>
    res.status(200).end(),
  moveBatchController: (_req: express.Request, res: express.Response) => res.status(200).end(),
  scrapBatchController: (_req: express.Request, res: express.Response) => res.status(200).end(),
  resolveBatchByLotNumberController: (_req: express.Request, res: express.Response) =>
    res.status(200).json({ route: 'resolve' }),
}));
vi.mock('../middlewares/validateBatchResolve.middleware', () => ({
  validateBatchResolve: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
}));
vi.mock('../middlewares/validateReceipt.middleware', () => ({
  validateReceiptParams: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
}));
vi.mock('../middlewares/validateQuarantineLift.middleware', () => ({
  validateQuarantineLift: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
}));
vi.mock('../middlewares/validateScrap.middleware', () => ({
  validateScrap: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}));
vi.mock('../../middlewares/verifyReceiptAccess.middleware', () => ({
  verifyReceiptAccess: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
}));
vi.mock('../../middlewares/verifyBatchAccess.middleware', () => ({
  verifyBatchAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}));

const { default: receiptRoutes } = await import('./receipt.routes');
const { globalErrorHandler } = await import('../../../../shared/utils/errorHandler/errorHandler');

const app = express();
app.use(express.json());
app.use('/api', receiptRoutes);
app.use(globalErrorHandler);

function signedInAs(role: string): void {
  getSession.mockResolvedValue({
    user: { id: 'u-1' },
    session: { activeOrganizationId: 'org-1' },
  });
  getFullOrganization.mockResolvedValue({ id: 'org-1', members: [{ userId: 'u-1', role }] });
}

beforeEach(() => vi.clearAllMocks());

describe('RBAC des routes logistiques (session réelle)', () => {
  describe('POST /logistics/receipts (écriture métier)', () => {
    it.each(['owner', 'admin', 'operator'])('autorise %s', async (role) => {
      signedInAs(role);
      const res = await request(app).post('/api/logistics/receipts').send({});
      expect(res.status).toBe(200);
    });

    it('refuse viewer (lecture seule)', async () => {
      signedInAs('viewer');
      const res = await request(app).post('/api/logistics/receipts').send({});
      expect(res.status).toBe(403);
    });
  });

  describe('POST /logistics/batches/:id/release (décision qualité)', () => {
    it.each(['owner', 'admin', 'quality'])('autorise %s', async (role) => {
      signedInAs(role);
      const res = await request(app).post('/api/logistics/batches/lot-1/release').send({});
      expect(res.status).toBe(200);
    });

    it('refuse operator — séparation des tâches HACCP (il réceptionne, il ne lève pas)', async () => {
      signedInAs('operator');
      const res = await request(app).post('/api/logistics/batches/lot-1/release').send({});
      expect(res.status).toBe(403);
    });

    it('refuse viewer', async () => {
      signedInAs('viewer');
      const res = await request(app).post('/api/logistics/batches/lot-1/release').send({});
      expect(res.status).toBe(403);
    });
  });

  describe('POST /logistics/batches/:id/quality-release (décision qualité)', () => {
    it.each(['owner', 'admin', 'quality'])('autorise %s', async (role) => {
      signedInAs(role);
      const res = await request(app).post('/api/logistics/batches/lot-1/quality-release').send({});
      expect(res.status).toBe(200);
    });

    it('refuse operator — celui qui produit ne lève pas sa propre non-conformité', async () => {
      signedInAs('operator');
      const res = await request(app).post('/api/logistics/batches/lot-1/quality-release').send({});
      expect(res.status).toBe(403);
    });

    it('refuse viewer', async () => {
      signedInAs('viewer');
      const res = await request(app).post('/api/logistics/batches/lot-1/quality-release').send({});
      expect(res.status).toBe(403);
    });
  });

  describe('POST /logistics/batches/:id/scrap (mise au rebut — décision qualité)', () => {
    it.each(['owner', 'admin', 'quality'])('autorise %s', async (role) => {
      signedInAs(role);
      const res = await request(app).post('/api/logistics/batches/lot-1/scrap').send({});
      expect(res.status).toBe(200);
    });

    it('refuse operator (celui qui produit ne décide pas de la destruction)', async () => {
      signedInAs('operator');
      const res = await request(app).post('/api/logistics/batches/lot-1/scrap').send({});
      expect(res.status).toBe(403);
    });

    it('refuse viewer', async () => {
      signedInAs('viewer');
      const res = await request(app).post('/api/logistics/batches/lot-1/scrap').send({});
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /logistics/batches/:id/location (déplacement — écriture métier)', () => {
    const body = { id_materiel: '11111111-1111-4111-8111-111111111111' };

    it.each(['owner', 'admin', 'operator'])('autorise %s', async (role) => {
      signedInAs(role);
      const res = await request(app).patch('/api/logistics/batches/lot-1/location').send(body);
      expect(res.status).toBe(200);
    });

    it('refuse viewer (lecture seule)', async () => {
      signedInAs('viewer');
      const res = await request(app).patch('/api/logistics/batches/lot-1/location').send(body);
      expect(res.status).toBe(403);
    });

    // Choix explicite, pas un oubli : déplacer est un geste de manutention, pas une décision
    // sanitaire. `quality` tranche la levée de quarantaine, il ne range pas la marchandise.
    // Le verrouiller par un test évite qu'on l'élargisse sans en mesurer la portée — depuis
    // qu'un lot BLOQUE est évacuable, cette garde décide qui manipule du stock consigné.
    it('refuse quality : la manutention n’est pas une décision qualité', async () => {
      signedInAs('quality');
      const res = await request(app).patch('/api/logistics/batches/lot-1/location').send(body);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /logistics/batches/resolve (le lot qu’on vient de scanner)', () => {
    // Express prend la PREMIÈRE route qui matche. Enregistrée après `/batches/:id`, la résolution
    // serait capturée comme un identifiant de lot nommé « resolve » → 404 sur chaque scan.
    it('n’est pas avalée par /batches/:id', async () => {
      signedInAs('operator');
      const res = await request(app)
        .get('/api/logistics/batches/resolve')
        .query({ lot_number: 'FRN-ABC123' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ route: 'resolve' });
    });

    // Lecture seule : tout le monde peut identifier un lot qu'il a sous les yeux.
    it.each(['owner', 'admin', 'quality', 'operator', 'viewer'])('autorise %s', async (role) => {
      signedInAs(role);
      const res = await request(app)
        .get('/api/logistics/batches/resolve')
        .query({ lot_number: 'FRN-ABC123' });

      expect(res.status).toBe(200);
    });

    it('refuse un rôle inconnu', async () => {
      signedInAs('stagiaire_curieux');
      const res = await request(app)
        .get('/api/logistics/batches/resolve')
        .query({ lot_number: 'FRN-ABC123' });

      expect(res.status).toBe(403);
    });
  });

  it('refuse un rôle inconnu', async () => {
    signedInAs('stagiaire_curieux');
    const res = await request(app).post('/api/logistics/receipts').send({});
    expect(res.status).toBe(403);
  });

  describe('la clé API n’écrit rien — même en déclarant un acteur légitime', () => {
    beforeEach(() => {
      process.env.API_KEY = 'cle-de-test';
      process.env.API_KEY_ORG_ID = 'org-1';
    });

    it('refuse une réception présentée avec la seule clé API', async () => {
      const res = await request(app)
        .post('/api/logistics/receipts')
        .set('x-api-key', 'cle-de-test')
        .send({});

      expect(res.status).toBe(401);
    });

    it("refuse même quand l'acteur déclaré est un membre parfaitement autorisé", async () => {
      // LE test qui manquait, et le cœur du sujet. Vérifier que l'acteur déclaré est membre avec
      // le bon rôle empêche de désigner un étranger — mais PAS d'usurper un collègue légitime.
      // Or la seule pièce d'identité de ce mode est la clé… qui est compilée dans le bundle
      // mobile, donc extractible par quiconque installe l'application. Une réception « signée du
      // patron » repartait alors dans la chaîne d'audit WORM, indiscernable d'une vraie.
      //
      // Une intégration machine passe désormais par un COMPTE DE SERVICE : un utilisateur, des
      // identifiants, une session — et une révocation possible.
      const res = await request(app)
        .post('/api/logistics/receipts')
        .set('x-api-key', 'cle-de-test')
        .send({ actorUserId: 'u-1' });

      expect(res.status).toBe(401);
    });
  });
});
