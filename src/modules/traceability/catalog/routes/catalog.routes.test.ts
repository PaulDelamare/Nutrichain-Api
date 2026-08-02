import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import catalogRoutes from './catalog.routes';
import { catalogService } from '../services/catalog.service';

// Mock du service
vi.mock('../services/catalog.service', () => ({
  catalogService: {
    getAllProducts: vi.fn(),
    getAllBatches: vi.fn(),
  },
}));

// Mock du middleware checkApiKey
vi.mock('../../../../shared/utils/checkApiKey/checkApiKey', () => ({
  checkApiKey: vi.fn(
    () => (req: express.Request, res: express.Response, next: express.NextFunction) => next()
  ),
}));

// Mock des middlewares d'authentification
vi.mock('../../../identity/middlewares/requireAuth.middleware', () => ({
  requireAuth: (
    req: express.Request & { activeOrgId?: string },
    res: express.Response,
    next: express.NextFunction
  ) => {
    req.activeOrgId = 'org-123';
    next();
  },
}));

vi.mock('../../../identity/middlewares/requireOrgRole.middleware', () => ({
  requireOrgRole: () => (req: express.Request, res: express.Response, next: express.NextFunction) =>
    next(),
}));

describe('Catalog Routes Integration', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api', catalogRoutes);
    // Sans gestionnaire d'erreurs, un refus de validation ressortirait en 500 par défaut d'Express.
    app.use(
      (
        err: Error & { status?: number },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => {
        res.status(err.status ?? 500).json(err);
      }
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/traceability/products', () => {
    it('doit retourner une liste de produits avec un statut 200', async () => {
      const mockProducts = [
        { id: '1', nom: 'Produit A' },
        { id: '2', nom: 'Produit B' },
      ];

      vi.mocked(catalogService.getAllProducts).mockResolvedValue(mockProducts as never[]);

      const res = await request(app).get('/api/traceability/products');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Produits récupérés avec succès');
      expect(res.body.data).toEqual(mockProducts);
      expect(catalogService.getAllProducts).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /api/traceability/batches', () => {
    it('doit retourner une page de lots avec son total et un statut 200', async () => {
      const mockPage = {
        data: [{ id: '1', id_produit: 'p1', quantite_actuelle: 100 }],
        pagination: { page: 1, limit: 100, total: 342, totalPages: 4 },
      };

      vi.mocked(catalogService.getAllBatches).mockResolvedValue(mockPage as never);

      const res = await request(app).get('/api/traceability/batches');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Lots récupérés avec succès');
      expect(res.body.data).toEqual(mockPage);
      expect(catalogService.getAllBatches).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * ⚠️ Verrouille le CÂBLAGE de la pagination, pas seulement son schéma : sans `page`/`limit` sur
   * la route, un lot au-delà des 100 plus récents restait inatteignable (issue #32).
   */
  describe('GET /api/traceability/batches — pagination', () => {
    it('transmet la page demandée au service, coercée en nombre', async () => {
      vi.mocked(catalogService.getAllBatches).mockResolvedValue({
        data: [],
        pagination: { page: 3, limit: 50, total: 342, totalPages: 7 },
      } as never);

      const res = await request(app).get('/api/traceability/batches?page=3&limit=50');

      expect(res.status).toBe(200);
      expect(catalogService.getAllBatches).toHaveBeenCalledWith(
        'org-123',
        expect.objectContaining({ page: 3, limit: 50 })
      );
    });

    it.each([
      ['une page nulle', 'page=0'],
      ['une page non numérique', 'page=abc'],
      ['une taille de page au-delà du plafond', 'limit=501'],
      ['une taille de page décimale', 'limit=5.7'],
    ])('refuse %s en 400 sans atteindre le service', async (_cas, query) => {
      const res = await request(app).get(`/api/traceability/batches?${query}`);

      expect(res.status).toBe(400);
      expect(catalogService.getAllBatches).not.toHaveBeenCalled();
    });
  });

  /**
   * ⚠️ Verrouille le CÂBLAGE de la borne. `?q=a&q=b` produit un TABLEAU côté Express : il partait
   * tel quel dans le `contains` de Prisma et sortait en 500. Un test de schéma isolé resterait vert
   * si l'on retirait le middleware de la route.
   */
  describe('GET /api/traceability/batches — terme de recherche borné', () => {
    it('refuse un terme répété (tableau) en 400 au lieu de sortir en 500', async () => {
      const res = await request(app).get('/api/traceability/batches?q=a&q=b');

      expect(res.status).toBe(400);
      expect(catalogService.getAllBatches).not.toHaveBeenCalled();
    });

    it('refuse un terme de recherche démesuré', async () => {
      const res = await request(app).get('/api/traceability/batches?q=' + 'x'.repeat(101));

      expect(res.status).toBe(400);
    });

    it('laisse passer une recherche normale', async () => {
      vi.mocked(catalogService.getAllBatches).mockResolvedValue({
        data: [],
        pagination: { page: 1, limit: 100, total: 0, totalPages: 0 },
      } as never);

      const res = await request(app).get('/api/traceability/batches?q=lait');

      expect(res.status).toBe(200);
      expect(catalogService.getAllBatches).toHaveBeenCalledWith(
        'org-123',
        expect.objectContaining({ search: 'lait' })
      );
    });
  });

  /**
   * Verrouille le CÂBLAGE des filtres de colonnes : ils doivent atteindre le service (donc la
   * requête Prisma), et un statut hors énumération est une requête malformée (400), pas un filtre
   * muet. Un test de schéma isolé resterait vert si l'on débranchait le middleware de la route.
   */
  describe('GET /api/traceability/batches — filtres de colonnes', () => {
    it('transmet statut/produit/site/lot/gtin au service', async () => {
      vi.mocked(catalogService.getAllBatches).mockResolvedValue({
        data: [],
        pagination: { page: 1, limit: 100, total: 0, totalPages: 0 },
      } as never);

      const res = await request(app).get(
        '/api/traceability/batches?statut=BLOQUE&produit=prod-1&site=loc-1&lot=000201&gtin=3042'
      );

      expect(res.status).toBe(200);
      expect(catalogService.getAllBatches).toHaveBeenCalledWith(
        'org-123',
        expect.objectContaining({
          statut: 'BLOQUE',
          produit: 'prod-1',
          site: 'loc-1',
          lot: '000201',
          gtin: '3042',
        })
      );
    });

    it('refuse un statut hors énumération en 400 sans atteindre le service', async () => {
      const res = await request(app).get('/api/traceability/batches?statut=PAS_UN_STATUT');

      expect(res.status).toBe(400);
      expect(catalogService.getAllBatches).not.toHaveBeenCalled();
    });
  });
});
